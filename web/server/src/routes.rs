use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::proxy::{self, ExtraHeaders, ModelRequestAuth};
use crate::publisher;
use crate::state::AppState;
use crate::storage::{self, NativeStorage, NativeStoreMutation};

/// Largest body the server buffers for an ordinary media request.
///
/// The client sends blobs up to 8 MB in one `put-raw` request and switches to
/// 4 MB chunks above that, so nothing legitimate exceeds this. Axum's own
/// default is 2 MB, which silently rejected every chunk until this was raised.
const MAX_MEDIA_REQUEST_BYTES: usize = 8 * 1024 * 1024;

/// Model JSON routes carry reference images/audio/video as base64, and the
/// multipart model route carries a base64 file inside a JSON body. The
/// decoded file itself may be up to `MAX_MODEL_UPLOAD_BYTES` (64 MiB) on the
/// proxy side. Base64 inflates that by 4/3 to roughly 85 MB, plus JSON framing.
///
/// Sending real `multipart/form-data` instead of JSON+base64 would drop the
/// inflation and is the better wire format; this only keeps parity with what
/// the desktop build already accepted.
const MAX_MODEL_PROXY_REQUEST_BYTES: usize = 128 * 1024 * 1024;

/// Route table for the browser bridge.
///
/// Every route replaces one former Tauri command. The `x-wg-*` metadata that
/// used to ride along as IPC request headers on the raw upload commands are now
/// ordinary HTTP request headers, so those handlers lost their data-URL and
/// base64 fallbacks entirely.
pub fn router() -> Router<AppState> {
    Router::new()
        .merge(crate::agent_runtime::router())
        .merge(crate::zodiac_plans::router())
        .merge(crate::canvas_cas::router())
        .route("/api/store/get", post(store_get))
        .route("/api/store/set", post(store_set))
        .route("/api/store/remove", post(store_remove))
        .route("/api/store/list", post(store_list))
        .route("/api/store/clear", post(store_clear))
        .route("/api/store/batch", post(store_batch))
        .route("/api/media/put-raw", post(media_put_raw))
        .route("/api/media/upload/begin", post(media_upload_begin))
        .route("/api/media/upload/chunk", post(media_upload_chunk))
        .route("/api/media/upload/commit", post(media_upload_commit))
        .route("/api/media/upload/abort", post(media_upload_abort))
        .route("/api/media/get", post(media_get))
        .route("/api/media/read-data-url", post(media_read_data_url))
        .route("/api/media/remove", post(media_remove))
        .route("/api/media/list", post(media_list))
        .route("/api/model/list", post(model_list))
        .route(
            "/api/model/json-post",
            post(model_json_post).layer(DefaultBodyLimit::max(MAX_MODEL_PROXY_REQUEST_BYTES)),
        )
        .route(
            "/api/model/raw-json-post",
            post(model_raw_json_post).layer(DefaultBodyLimit::max(MAX_MODEL_PROXY_REQUEST_BYTES)),
        )
        .route(
            "/api/model/multipart-post",
            post(model_multipart_post).layer(DefaultBodyLimit::max(MAX_MODEL_PROXY_REQUEST_BYTES)),
        )
        .route(
            "/api/model/proxy-post",
            post(model_proxy_post).layer(DefaultBodyLimit::max(MAX_MODEL_PROXY_REQUEST_BYTES)),
        )
        .route("/api/model/json-get", post(model_json_get))
        .route("/api/media/fetch-remote", post(fetch_remote_media))
        .route("/api/media/proxy-bytes", post(media_proxy_bytes))
        .route("/api/publisher/verify", post(publisher::verify))
        .route("/media/{bucket}/{url_key}", get(serve_media))
        .layer(DefaultBodyLimit::max(MAX_MEDIA_REQUEST_BYTES))
}

/// Maps a storage error onto a response the frontend can surface verbatim. The
/// ported code already returns a user-facing Chinese message in the `Err` arm,
/// so it is passed through as the body rather than swallowed.
fn fail(error: String) -> Response {
    (StatusCode::BAD_REQUEST, error).into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreKeyRequest {
    namespace: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreSetRequest {
    namespace: String,
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreNamespaceRequest {
    namespace: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreBatchRequest {
    mutations: Vec<NativeStoreMutation>,
}

async fn store_get(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<StoreKeyRequest>,
) -> Response {
    match storage::native_store_get(state, request.namespace, request.key).await {
        Ok(value) => Json(value).into_response(),
        Err(error) => fail(error),
    }
}

async fn store_set(
    State(state): State<AppState>,
    Json(request): Json<StoreSetRequest>,
) -> Response {
    let storage = state.storage.clone();
    match storage::native_store_set(
        State(storage.clone()),
        request.namespace.clone(),
        request.key.clone(),
        request.value,
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => fail(error),
    }
}

async fn store_remove(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<StoreKeyRequest>,
) -> Response {
    match storage::native_store_remove(state, request.namespace, request.key).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => fail(error),
    }
}

async fn store_list(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<StoreNamespaceRequest>,
) -> Response {
    match storage::native_store_list(state, request.namespace).await {
        Ok(entries) => Json(entries).into_response(),
        Err(error) => fail(error),
    }
}

async fn store_clear(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<StoreNamespaceRequest>,
) -> Response {
    match storage::native_store_clear(state, request.namespace).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => fail(error),
    }
}

async fn store_batch(
    State(state): State<AppState>,
    Json(request): Json<StoreBatchRequest>,
) -> Response {
    let storage = state.storage.clone();
    // 批次里只要有一处写的是渠道设置，就同样触发一次同步。
    match storage::native_store_batch(State(storage.clone()), request.mutations).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => fail(error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaKeyRequest {
    bucket: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaBucketRequest {
    bucket: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaUploadBeginRequest {
    bucket: String,
    key: String,
    mime_type: String,
    expected_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaUploadFinishRequest {
    bucket: String,
    key: String,
    mime_type: String,
    expected_bytes: u64,
    upload_id: String,
}

async fn media_put_raw(
    state: State<Arc<NativeStorage>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match storage::native_media_put_raw(state, headers, body).await {
        Ok(record) => Json(record).into_response(),
        Err(error) => fail(error),
    }
}

async fn media_upload_begin(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<MediaUploadBeginRequest>,
) -> Response {
    match storage::native_media_upload_begin(
        state,
        request.bucket,
        request.key,
        request.mime_type,
        request.expected_bytes,
    )
    .await
    {
        Ok(upload_id) => Json(upload_id).into_response(),
        Err(error) => fail(error),
    }
}

async fn media_upload_chunk(
    state: State<Arc<NativeStorage>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match storage::native_media_upload_chunk(state, headers, body).await {
        Ok(received) => Json(received).into_response(),
        Err(error) => fail(error),
    }
}

async fn media_upload_commit(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<MediaUploadFinishRequest>,
) -> Response {
    match storage::native_media_upload_commit(
        state,
        request.bucket,
        request.key,
        request.mime_type,
        request.expected_bytes,
        request.upload_id,
    )
    .await
    {
        Ok(record) => Json(record).into_response(),
        Err(error) => fail(error),
    }
}

async fn media_upload_abort(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<MediaUploadFinishRequest>,
) -> Response {
    match storage::native_media_upload_abort(
        state,
        request.bucket,
        request.key,
        request.mime_type,
        request.expected_bytes,
        request.upload_id,
    )
    .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => fail(error),
    }
}

async fn media_get(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<MediaKeyRequest>,
) -> Response {
    match storage::native_media_get(state, request.bucket, request.key).await {
        Ok(record) => Json(record).into_response(),
        Err(error) => fail(error),
    }
}

async fn media_read_data_url(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<MediaKeyRequest>,
) -> Response {
    match storage::native_media_read_data_url(state, request.bucket, request.key).await {
        Ok(data_url) => Json(data_url).into_response(),
        Err(error) => fail(error),
    }
}

async fn media_remove(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<MediaKeyRequest>,
) -> Response {
    match storage::native_media_remove(state, request.bucket, request.key).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => fail(error),
    }
}

async fn media_list(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<MediaBucketRequest>,
) -> Response {
    match storage::native_media_list(state, request.bucket).await {
        Ok(records) => Json(records).into_response(),
        Err(error) => fail(error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelListRequest {
    url: String,
    api_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelJsonPostRequest {
    url: String,
    api_key: String,
    body: serde_json::Value,
    auth: Option<ModelRequestAuth>,
    /// Provider protocol headers such as `anthropic-version`. Validated against
    /// a whitelist in `proxy::apply_extra_headers`.
    headers: ExtraHeaders,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRawJsonPostRequest {
    url: String,
    api_key: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelMultipartPostRequest {
    url: String,
    api_key: String,
    file_field: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
    fields: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteMediaRequest {
    bucket: String,
    key: String,
    url: String,
    expected_sha256: Option<String>,
    max_bytes: Option<usize>,
    allow_private_network: Option<bool>,
}

async fn model_list(Json(request): Json<ModelListRequest>) -> Response {
    match proxy::native_fetch_model_list(request.url, request.api_key).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => fail(error),
    }
}

async fn model_json_post(Json(request): Json<ModelJsonPostRequest>) -> Response {
    match proxy::native_model_json_post(
        request.url,
        request.api_key,
        request.body,
        request.auth,
        request.headers,
    )
    .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => fail(error),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteBytesRequest {
    url: String,
    max_bytes: Option<usize>,
    allow_private_network: Option<bool>,
}

/// Returns a remote file's bytes without storing them, for provider results the
/// browser cannot read cross-origin.
async fn media_proxy_bytes(Json(request): Json<RemoteBytesRequest>) -> Response {
    match proxy::native_fetch_remote_bytes(
        request.url,
        request.max_bytes,
        request.allow_private_network.unwrap_or(false),
    )
    .await
    {
        Ok((content_type, bytes)) => Response::builder()
            .status(StatusCode::OK)
            .header(
                http::header::CONTENT_TYPE,
                content_type.unwrap_or_else(|| "application/octet-stream".to_string()),
            )
            .header(http::header::CACHE_CONTROL, "no-store")
            .body(axum::body::Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        Err(error) => fail(error),
    }
}

/// Proxies a server-sent-events provider call, forwarding status and content
/// type untouched so the browser can parse the stream with the same code it used
/// when it talked to the provider directly.
async fn model_proxy_post(Json(request): Json<ModelJsonPostRequest>) -> Response {
    let upstream = match proxy::native_model_proxy_post(
        request.url,
        request.api_key,
        request.body,
        request.auth,
        request.headers,
    )
    .await
    {
        Ok(upstream) => upstream,
        Err(error) => return fail(error),
    };
    let status = upstream.status();
    let content_type = upstream
        .headers()
        .get(http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("text/event-stream")
        .to_string();
    // `bytes_stream` keeps chunks arriving as the provider emits them; buffering
    // here would defeat the entire point of the streaming route.
    let body = axum::body::Body::from_stream(upstream.bytes_stream());
    Response::builder()
        .status(status)
        .header(http::header::CONTENT_TYPE, content_type)
        .header(http::header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn model_raw_json_post(Json(request): Json<ModelRawJsonPostRequest>) -> Response {
    match proxy::native_model_raw_json_post(request.url, request.api_key, request.body).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => fail(error),
    }
}

async fn model_multipart_post(Json(request): Json<ModelMultipartPostRequest>) -> Response {
    match proxy::native_model_multipart_post(
        request.url,
        request.api_key,
        request.file_field,
        request.file_name,
        request.mime_type,
        request.data_base64,
        request.fields,
    )
    .await
    {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => fail(error),
    }
}

async fn model_json_get(Json(request): Json<ModelListRequest>) -> Response {
    match proxy::native_model_json_get(request.url, request.api_key).await {
        Ok(payload) => Json(payload).into_response(),
        Err(error) => fail(error),
    }
}

async fn fetch_remote_media(
    state: State<Arc<NativeStorage>>,
    Json(request): Json<RemoteMediaRequest>,
) -> Response {
    match proxy::native_fetch_remote_media(
        state,
        request.url,
        request.bucket,
        request.key,
        request.expected_sha256,
        request.max_bytes,
        request.allow_private_network,
    )
    .await
    {
        Ok(record) => Json(record).into_response(),
        Err(error) => fail(error),
    }
}

/// Serves stored media as a plain HTTP resource. Keeps the Range support the
/// desktop `wg-media:` handler provided so `<video>` seeking still works, and
/// drops the `Access-Control-Allow-Origin` header that only existed to let the
/// app's own WebView read its custom scheme.
async fn serve_media(
    State(storage): State<Arc<NativeStorage>>,
    Path((bucket, url_key)): Path<(String, String)>,
    method: axum::http::Method,
    headers: HeaderMap,
) -> Response {
    // The Range header must be forwarded: `media_protocol` implements byte
    // ranges itself, and dropping the header here silently degrades every
    // seekable response to a full 200 — which breaks `<video>` scrubbing.
    let mut forward = http::Request::builder()
        .method(method)
        .uri(format!("/{bucket}/{url_key}"));
    if let Some(range) = headers.get(http::header::RANGE) {
        forward = forward.header(http::header::RANGE, range);
    }
    let forward = forward
        .body(Vec::new())
        .unwrap_or_else(|_| http::Request::new(Vec::new()));
    let response = storage::media_protocol(&storage, &forward);
    let (parts, body) = response.into_parts();
    Response::from_parts(parts, axum::body::Body::from(body))
}

#[cfg(test)]
mod request_limit_tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[tokio::test]
    async fn model_json_routes_accept_large_references_without_relaxing_store_limits() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState { storage: Arc::new(storage::initialize(dir.path()).unwrap()) };
        let app = router().with_state(state);
        // Invalid URL stops at local validation: no provider request or credentials.
        let padding = "a".repeat(9 * 1024 * 1024);
        for endpoint in ["json-post", "raw-json-post"] {
            let body = if endpoint == "json-post" { serde_json::json!({"image": padding}) } else { serde_json::json!(padding) };
            let response = app.clone().oneshot(Request::post(format!("/api/model/{endpoint}"))
                .header("content-type", "application/json")
                .body(Body::from(serde_json::json!({"url":"not-a-url", "apiKey":"fixture", "body":body}).to_string())).unwrap()).await.unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{endpoint} must reach URL validation instead of rejecting valid-size media references");
        }
        let response = app.oneshot(Request::post("/api/store/set").header("content-type", "application/json")
            .body(Body::from(serde_json::json!({"namespace":"fixture", "key":"large", "value":padding}).to_string())).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }
}

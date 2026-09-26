pub mod data_layout;
mod agent_runtime;
mod canvas_cas;
mod proxy;
mod publisher;
mod routes;
mod state;
mod storage;
mod zodiac_plans;

use axum::{
    body::Body,
    extract::{Query, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
};
use futures_util::StreamExt;
use serde::Deserialize;
use std::{path::{Path, PathBuf}, sync::Arc};
use tokio::io::AsyncWriteExt;
use tower_http::services::{ServeDir, ServeFile};

/// The desktop owns the listener and its session. No connector or external daemon.
pub async fn serve_desktop(
    listener: tokio::net::TcpListener,
    data: &Path,
    assets: &Path,
    downloads: &Path,
    token: String,
    close: Arc<dyn Fn() + Send + Sync>,
) -> Result<(), String> {
    let app_state = state::AppState {
        storage: Arc::new(storage::initialize(data)?),
    };
    let origin = format!(
        "http://{}",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    let download_directory = downloads.to_owned();
    let outputs = axum::Router::new().route(
        "/api/desktop/workspace",
        axum::routing::post(open_workspace),
    ).route("/api/desktop/data", axum::routing::post(open_data))
      .route("/api/desktop/download", axum::routing::post(move |query, body| save_download(query, body, download_directory.clone())));
    let app = routes::router()
        .merge(outputs)
        .with_state(app_state)
        .fallback_service(ServeDir::new(assets).fallback(ServeFile::new(assets.join("index.html"))))
        .layer(middleware::from_fn_with_state(
            Arc::new(DesktopSession {
                token,
                origin,
                close,
            }),
            desktop_session,
        ));
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct DownloadQuery { filename: String }

async fn save_download(Query(query): Query<DownloadQuery>, body: Body, directory: PathBuf) -> Response {
    let filename = query.filename.trim();
    if filename.is_empty() || filename.len() > 180 || filename == "." || filename == ".."
        || filename.chars().any(|character| character.is_control() || matches!(character, '/' | '\\' | ':'))
    {
        return (StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error":"文件名无效"}))).into_response();
    }
    if let Err(error) = tokio::fs::create_dir_all(&directory).await {
        return download_error(error.to_string());
    }
    let name = Path::new(filename);
    let stem = name.file_stem().and_then(|value| value.to_str()).unwrap_or(filename);
    let extension = name.extension().and_then(|value| value.to_str());
    let mut destination = None;
    for index in 0..1000 {
        let candidate = if index == 0 { filename.to_owned() } else if let Some(extension) = extension {
            format!("{stem} ({index}).{extension}")
        } else {
            format!("{stem} ({index})")
        };
        let path = directory.join(&candidate);
        match tokio::fs::OpenOptions::new().write(true).create_new(true).open(&path).await {
            Ok(file) => { destination = Some((path, candidate, file)); break; }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return download_error(error.to_string()),
        }
    }
    let Some((path, saved_name, mut file)) = destination else { return download_error("下载目录中同名文件过多".into()); };
    let mut stream = body.into_data_stream();
    let mut total = 0usize;
    let result = async {
        while let Some(next) = stream.next().await {
            let bytes = next.map_err(|error| error.to_string())?;
            total = total.checked_add(bytes.len()).ok_or("文件过大")?;
            if total > 2 * 1024 * 1024 * 1024 { return Err("文件超过 2 GiB".into()); }
            file.write_all(&bytes).await.map_err(|error| error.to_string())?;
        }
        if total == 0 { return Err("文件内容为空".into()); }
        file.flush().await.map_err(|error| error.to_string())?;
        file.sync_all().await.map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    }.await;
    drop(file);
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(path).await;
        return download_error(error);
    }
    (StatusCode::OK, axum::Json(serde_json::json!({"fileName": saved_name}))).into_response()
}

fn download_error(error: String) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({"error": error}))).into_response()
}

async fn open_workspace(State(state): State<state::AppState>) -> Response {
    open_directory(storage::workspace_root(&state.storage))
}
async fn open_data(State(state): State<state::AppState>) -> Response {
    open_directory(storage::app_data_root(&state.storage))
}
fn open_directory(path: Result<std::path::PathBuf, String>) -> Response {
    let result = path.and_then(|path| {
        #[cfg(target_os = "macos")]
        {
            let status = std::process::Command::new("/usr/bin/open").arg(path).status().map_err(|e| e.to_string())?;
            if status.success() { Ok(()) } else { Err("无法打开访达".into()) }
        }
        #[cfg(not(target_os = "macos"))]
        { let _ = path; Err("当前系统不支持访达".into()) }
    });
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({"error":error}))).into_response(),
    }
}

struct DesktopSession {
    token: String,
    origin: String,
    close: Arc<dyn Fn() + Send + Sync>,
}
async fn desktop_session(
    State(session): State<Arc<DesktopSession>>,
    request: Request,
    next: Next,
) -> Response {
    if request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        != session.origin.strip_prefix("http://")
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request
        .headers()
        .get(header::ORIGIN)
        .is_some_and(|v| v.as_bytes() != session.origin.as_bytes())
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if request.uri().path() == format!("/_desktop/{}", session.token) {
        let mut response = Redirect::to("/").into_response();
        response.headers_mut().insert(
            header::SET_COOKIE,
            format!(
                "wg-desktop={}; HttpOnly; SameSite=Strict; Path=/",
                session.token
            )
            .parse()
            .unwrap(),
        );
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
        response
            .headers_mut()
            .insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
        return response;
    }
    let cookie = format!("wg-desktop={}", session.token);
    if !request
        .headers()
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(';').any(|p| p.trim() == cookie))
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if request.uri().path() == "/api/desktop/close-ready"
        && request.method() == axum::http::Method::POST
    {
        agent_runtime::shutdown().await;
        (session.close)();
        return StatusCode::NO_CONTENT.into_response();
    }
    next.run(request).await
}

#[cfg(test)]
mod desktop_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    #[tokio::test]
    async fn desktop_requires_session_and_rejects_foreign_origins() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.html"), "desktop").unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let path = dir.path().to_owned();
        let server_path = path.clone();
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        let task = tokio::spawn(async move {
            serve_desktop(
                listener,
                &server_path.join("store"),
                &server_path,
                &server_path.join("downloads"),
                "fixture".into(),
                Arc::new(move || {
                    flag.store(true, Ordering::SeqCst);
                }),
            )
            .await
        });
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        assert_eq!(
            client.get(&origin).send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        let boot = client
            .get(format!("{origin}/_desktop/fixture"))
            .send()
            .await
            .unwrap();
        assert_eq!(boot.status(), StatusCode::SEE_OTHER);
        assert!(boot.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("HttpOnly; SameSite=Strict"));
        let page = client
            .get(&origin)
            .header(header::COOKIE, "wg-desktop=fixture")
            .send()
            .await
            .unwrap();
        assert_eq!(page.text().await.unwrap(), "desktop");
        let first = client
            .post(format!("{origin}/api/desktop/download?filename=sample.mp4"))
            .header(header::COOKIE, "wg-desktop=fixture")
            .body("video bytes")
            .send().await.unwrap();
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(first.json::<serde_json::Value>().await.unwrap()["fileName"], "sample.mp4");
        assert_eq!(std::fs::read(path.join("downloads/sample.mp4")).unwrap(), b"video bytes");
        let second = client
            .post(format!("{origin}/api/desktop/download?filename=sample.mp4"))
            .header(header::COOKIE, "wg-desktop=fixture")
            .body("second")
            .send().await.unwrap();
        assert_eq!(second.status(), StatusCode::OK);
        assert_eq!(second.json::<serde_json::Value>().await.unwrap()["fileName"], "sample (1).mp4");
        assert_eq!(std::fs::read(path.join("downloads/sample.mp4")).unwrap(), b"video bytes");
        assert_eq!(std::fs::read(path.join("downloads/sample (1).mp4")).unwrap(), b"second");
        let invalid = client
            .post(format!("{origin}/api/desktop/download?filename=..%2Fsecret"))
            .header(header::COOKIE, "wg-desktop=fixture")
            .body("private")
            .send().await.unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        let empty = client
            .post(format!("{origin}/api/desktop/download?filename=empty.mp4"))
            .header(header::COOKIE, "wg-desktop=fixture")
            .send().await.unwrap();
        assert_eq!(empty.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(!path.join("downloads/empty.mp4").exists());
        let rejected = client
            .post(format!("{origin}/api/desktop/close-ready"))
            .header(header::COOKIE, "wg-desktop=fixture")
            .header(header::ORIGIN, "https://foreign.example")
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::FORBIDDEN);
        assert!(!closed.load(Ordering::SeqCst));
        assert_eq!(
            client
                .post(format!("{origin}/api/desktop/close-ready"))
                .header(header::COOKIE, "wg-desktop=fixture")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        assert!(closed.load(Ordering::SeqCst));
        task.abort();
    }
}

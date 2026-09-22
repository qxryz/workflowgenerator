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
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Redirect, Response},
};
use std::{path::Path, sync::Arc};
use tower_http::services::{ServeDir, ServeFile};

/// The desktop owns the listener and its session. No connector or external daemon.
pub async fn serve_desktop(
    listener: tokio::net::TcpListener,
    data: &Path,
    assets: &Path,
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
    let outputs = axum::Router::new().route(
        "/api/desktop/workspace",
        axum::routing::post(open_workspace),
    ).route("/api/desktop/data", axum::routing::post(open_data));
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
        let closed = Arc::new(AtomicBool::new(false));
        let flag = closed.clone();
        let task = tokio::spawn(async move {
            serve_desktop(
                listener,
                &path.join("store"),
                &path,
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

mod data_layout;
mod agent_runtime;
mod canvas_cas;
mod proxy;
mod publisher;
mod routes;
mod state;
mod storage;
mod zodiac_plans;

use std::{
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::Arc,
};

use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;

/// Networking defaults to loopback so an unauthenticated deployment is not
/// reachable from the network unless the operator asks for it.
const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3000;
const DEFAULT_DATA_DIR: &str = ".zodiac-dev";
const DEFAULT_STATIC_DIR: &str = "dist";

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("启动失败：{error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let host: IpAddr = env_var("WG_HOST", DEFAULT_HOST)
        .parse()
        .map_err(|_| "WG_HOST 不是有效的 IP 地址".to_string())?;
    let port: u16 = env_var("WG_PORT", &DEFAULT_PORT.to_string())
        .parse()
        .map_err(|_| "WG_PORT 不是有效的端口".to_string())?;
    let data_dir = PathBuf::from(env_var("WG_DATA_DIR", DEFAULT_DATA_DIR));
    let static_dir = PathBuf::from(env_var("WG_STATIC_DIR", DEFAULT_STATIC_DIR));

    let storage = Arc::new(storage::initialize(&data_dir)?);
    let app_state = AppState {
        storage: storage.clone(),
    };

    // SPA fallback: unknown paths return index.html so client-side routes such
    // as /canvas/<id> survive a hard refresh.
    let static_files =
        ServeDir::new(&static_dir).fallback(ServeFile::new(static_dir.join("index.html")));

    let app = routes::router()
        .with_state(app_state)
        .fallback_service(static_files);

    let address = SocketAddr::new(host, port);
    let listener = TcpListener::bind(address)
        .await
        .map_err(|error| format!("无法监听 {address}：{error}"))?;

    println!("WorkflowGenerator 已启动：http://{address}");
    println!("数据目录：{}", data_dir.display());

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; agent_runtime::shutdown().await; })
    .await
    .map_err(|error| format!("服务异常退出：{error}"))
}

fn env_var(name: &str, fallback: &str) -> String {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::Manager;
const FLUSH_AND_CLOSE: &str = "if (window.dispatchEvent(new Event('workflowgenerator:desktop-close', {cancelable: true}))) fetch('/api/desktop/close-ready', {method: 'POST'})";
fn main() {
    let closing = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let close_approved = closing.clone();
    let runtime = tauri::Builder::default().plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init()).setup(move |app| {
        let data = match std::env::var_os("WG_DATA_DIR") {
            Some(path) => std::path::PathBuf::from(path),
            None => workflowgenerator_server::data_layout::desktop_root(&app.path().home_dir()?, &app.path().app_data_dir()?).map_err(std::io::Error::other)?,
        };
        let assets = if cfg!(debug_assertions) { std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist") } else { app.path().resource_dir()?.join("web") };
        if !assets.join("index.html").exists() { return Err("界面资源缺失，请重新安装应用。".into()); }
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let address = listener.local_addr()?;
        let token = uuid::Uuid::new_v4().to_string();
        let url = format!("http://{address}/_desktop/{token}");
        let handle = app.handle().clone();
        let approved = close_approved.clone();
        let close: std::sync::Arc<dyn Fn() + Send + Sync> = std::sync::Arc::new(move || { approved.store(true, std::sync::atomic::Ordering::SeqCst); handle.exit(0); });
        tauri::async_runtime::spawn(async move {
            let listener = tokio::net::TcpListener::from_std(listener).expect("desktop listener");
            if let Err(error) = workflowgenerator_server::serve_desktop(listener, &data, &assets, token, close).await { eprintln!("{error}"); }
        });
        let origin = format!("http://{address}");
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url.parse()?))
            .title("WorkflowGenerator").inner_size(1440.0, 940.0).min_inner_size(1000.0, 680.0)
            .on_navigation(move |url| url.origin().ascii_serialization() == origin)
            .on_new_window(|url, _| {
                #[cfg(target_os = "macos")]
                if matches!(url.scheme(), "https" | "http" | "mailto" | "tel") {
                    let _ = std::process::Command::new("/usr/bin/open").arg(url.as_str()).spawn();
                }
                tauri::webview::NewWindowResponse::Deny
            })
            .build()?;
        Ok(())
    }).on_window_event(|window, event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(webview) = window.app_handle().get_webview_window("main") { let _ = webview.eval(FLUSH_AND_CLOSE); }
        }
    }).build(tauri::generate_context!()).expect("无法启动桌面应用");
    runtime.run(move |app, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            if code != Some(tauri::RESTART_EXIT_CODE) && !closing.load(std::sync::atomic::Ordering::SeqCst) {
                api.prevent_exit();
                if let Some(webview) = app.get_webview_window("main") { let _ = webview.eval(FLUSH_AND_CLOSE); }
            }
        }
    });
}

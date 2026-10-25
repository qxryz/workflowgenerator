use axum::{
    body::Body,
    extract::Request,
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// SPA routes may fall back to index.html, but a missing JavaScript chunk must
/// remain a 404. Returning HTML for a module request produces a misleading
/// browser MIME error and prevents the frontend from recovering cleanly.
pub async fn reject_html_asset_fallback(request: Request<Body>, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;

    if is_asset_path(&path)
        && response.status().is_success()
        && response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("text/html"))
    {
        return StatusCode::NOT_FOUND.into_response();
    }

    response
}

fn is_asset_path(path: &str) -> bool {
    // HTML entry points are real application documents, not module assets.
    !path.ends_with(".html")
        && (path == "/config.js"
        || path.starts_with("/assets/")
        || path.starts_with("/plugins/")
        || path.starts_with("/brand/")
        || path.starts_with("/icons/")
        || path.starts_with("/models/")
        || path.rsplit('/').next().is_some_and(|name| name.contains('.')))
}

#[cfg(test)]
mod tests {
    use super::is_asset_path;

    #[test]
    fn distinguishes_spa_routes_from_static_assets() {
        assert!(!is_asset_path("/canvas/example"));
        assert!(!is_asset_path("/canvas/example/nested/route"));
        assert!(!is_asset_path("/index.html"));
        assert!(is_asset_path("/assets/detail-old.js"));
        assert!(is_asset_path("/config.js"));
        assert!(is_asset_path("/brand/wg.svg"));
        assert!(is_asset_path("/author-library/catalog.json"));
    }
}

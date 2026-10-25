use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::extract::State;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use sha2::{Digest, Sha256};

use crate::storage::{self, NativeMediaRecord, NativeStorage};

/// Outbound HTTP for provider credentials and generated media.
///
/// This is the only part of the server that talks to arbitrary remote hosts, so
/// every entry point re-validates the destination instead of trusting the
/// caller: provider URLs must be HTTPS (loopback HTTP is the single exception,
/// for local model servers), and media downloads resolve DNS first so the
/// connection can be pinned to an address that passed the private-network
/// filter.
fn validate_credential_url(value: &str, label: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(value.trim()).map_err(|_| format!("{label}无效"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(format!("{label}不能在网址中包含账号或密码"));
    }
    let loopback_http = parsed.scheme() == "http"
        && parsed.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        });
    if parsed.scheme() != "https" && !loopback_http {
        return Err(format!("{label}必须使用 HTTPS；本机 localhost 可使用 HTTP"));
    }
    Ok(parsed)
}

/// Reads a response body while enforcing `max_bytes`.
///
/// The check is applied per chunk rather than after buffering, so an oversized
/// or unbounded provider response is rejected before it is held in memory.
type ResponseBytes = (reqwest::StatusCode, reqwest::header::HeaderMap, Vec<u8>);

enum ResponseReadError {
    TooLarge,
    Network(reqwest::Error),
}

async fn read_limited_response_bytes(
    response: reqwest::Response,
    max_bytes: usize,
    read_error: &str,
    too_large: &str,
) -> Result<ResponseBytes, String> {
    read_limited_response(response, max_bytes).await.map_err(|error| match error {
        ResponseReadError::TooLarge => too_large.to_string(),
        ResponseReadError::Network(error) => format!("{read_error}：{error}"),
    })
}

async fn read_limited_response(
    mut response: reqwest::Response,
    max_bytes: usize,
) -> Result<ResponseBytes, ResponseReadError> {
    if response
        .content_length()
        .is_some_and(|length| length as usize > max_bytes)
    {
        return Err(ResponseReadError::TooLarge);
    }
    let status = response.status();
    let headers = response.headers().clone();
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(max_bytes as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(ResponseReadError::Network)?
    {
        if bytes.len().saturating_add(chunk.len()) > max_bytes {
            return Err(ResponseReadError::TooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((status, headers, bytes))
}

fn is_public_remote_address(address: std::net::IpAddr) -> bool {
    match address {
        std::net::IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || a >= 224)
        }
        std::net::IpAddr::V6(ip) => {
            if let Some(ipv4) = ip.to_ipv4_mapped() {
                return is_public_remote_address(std::net::IpAddr::V4(ipv4));
            }
            let first = ip.segments()[0];
            !(ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || (ip.segments()[0] == 0x2001 && ip.segments()[1] == 0x0db8))
        }
    }
}

fn select_remote_media_addresses(
    resolved: Vec<std::net::SocketAddr>,
    allow_private_network: bool,
) -> Result<Vec<std::net::SocketAddr>, String> {
    if resolved.is_empty() {
        return Err("无法解析媒体服务器地址".into());
    }
    if allow_private_network {
        return Ok(resolved);
    }
    let public: Vec<_> = resolved
        .iter()
        .copied()
        .filter(|address| is_public_remote_address(address.ip()))
        .collect();
    if !public.is_empty() {
        return Ok(public);
    }
    Err("媒体地址指向本机或内网，已停止下载；若使用 Fake-IP 代理，请在“设置 → 本地与网络”开启“允许私有网络媒体下载”".into())
}

/// Resolves and pins the download address, following redirects manually.
///
/// Automatic redirect following would re-enter the client without the
/// private-network check, so each hop is resolved, filtered and pinned again
/// before the next request is issued.
async fn request_public_remote_media(
    url: reqwest::Url,
    allow_private_network: bool,
) -> Result<(reqwest::Response, reqwest::Url), MediaDownloadError> {
    request_remote_media_range(url, allow_private_network, None).await
}

#[derive(Clone)]
struct MediaRange {
    start: usize,
    end: usize,
    etag: Option<reqwest::header::HeaderValue>,
}

async fn request_remote_media_range(
    mut url: reqwest::Url,
    allow_private_network: bool,
    range: Option<MediaRange>,
) -> Result<(reqwest::Response, reqwest::Url), MediaDownloadError> {
    const MAX_REDIRECTS: usize = 5;
    for redirect_count in 0..=MAX_REDIRECTS {
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
            return Err(MediaDownloadError::permanent("媒体地址必须使用不含账号信息的 HTTPS 地址"));
        }
        let host = url
            .host_str()
            .ok_or_else(|| MediaDownloadError::permanent("媒体地址缺少服务器名称"))?;
        let port = url.port_or_known_default().unwrap_or(443);
        let resolved = tokio::net::lookup_host((host, port))
            .await
            .map_err(|_| MediaDownloadError::permanent("无法解析媒体服务器地址"))?
            .collect();
        let resolved = select_remote_media_addresses(resolved, allow_private_network).map_err(MediaDownloadError::permanent)?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .resolve_to_addrs(host, &resolved)
            .build()
            .map_err(|_| MediaDownloadError::permanent("无法创建媒体下载请求"))?;
        let mut request = client.get(url.clone());
        if let Some(range) = &range {
            request = request.header(reqwest::header::ACCEPT_ENCODING, "identity").header(reqwest::header::RANGE, format!("bytes={}-{}", range.start, range.end));
            if let Some(etag) = &range.etag {
                request = request.header(reqwest::header::IF_RANGE, etag);
            }
        }
        let response = request
            .send()
            .await
            .map_err(MediaDownloadError::network)?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(MediaDownloadError::permanent("媒体下载重定向次数过多"));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| MediaDownloadError::permanent("媒体下载返回了无效重定向"))?;
            url = url
                .join(location)
                .map_err(|_| MediaDownloadError::permanent("媒体下载返回了无效重定向"))?;
            continue;
        }
        return Ok((response, url));
    }
    Err(MediaDownloadError::permanent("媒体下载重定向次数过多"))
}

#[derive(Debug)]
struct MediaDownloadError {
    message: String,
    retryable: bool,
}

impl MediaDownloadError {
    fn permanent(message: impl Into<String>) -> Self {
        Self { message: message.into(), retryable: false }
    }

    fn network(error: reqwest::Error) -> Self {
        let reason = model_network_failure_reason(&error, error.is_timeout(), error.is_dns(), error.is_connect());
        let interrupted = reason == "网络连接中断" || media_body_interrupted(&error);
        let retryable = error.is_timeout() || interrupted;
        let message = if error.is_timeout() {
            "媒体下载超时，请重试保存".to_string()
        } else if interrupted {
            "媒体下载中断，请重试保存".to_string()
        } else {
            format!("媒体下载失败：{}", if reason == "无法连接模型服务" { "无法连接媒体服务器" } else { reason })
        };
        Self { message, retryable }
    }
}

fn media_body_interrupted(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut cause = Some(error);
    for _ in 0..16 {
        let Some(current) = cause else { break };
        // Match transport evidence only; never expose the raw cause or signed URL.
        if !current.is::<reqwest::Error>() {
            let text = current.to_string().to_ascii_lowercase();
            if ["end of file before message length reached", "unexpected eof", "unexpected end of file", "incomplete message", "stream reset", "stream was reset"].iter().any(|part| text.contains(part)) {
                return true;
            }
        }
        cause = current.source();
    }
    false
}

#[cfg(test)]
mod media_download_tests {
    use super::{checked_media_range, download_remote_media, read_media_range, read_remote_media_response, retry_remote_media, MediaDownloadError, MediaRange};
    use std::{sync::atomic::{AtomicUsize, Ordering}, time::Duration};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn local_media_server(responses: Vec<&'static [u8]>) -> (reqwest::Url, tokio::task::JoinHandle<Vec<String>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut methods = Vec::new();
            for response in responses {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0; 1024];
                while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                    let read = socket.read(&mut buffer).await.unwrap();
                    assert!(read > 0 && request.len() < 8192);
                    request.extend_from_slice(&buffer[..read]);
                }
                methods.push(String::from_utf8_lossy(&request).split_whitespace().next().unwrap().to_string());
                socket.write_all(response).await.unwrap();
                socket.shutdown().await.unwrap();
            }
            methods
        });
        (reqwest::Url::parse(&format!("http://{address}/completed.mp4")).unwrap(), server)
    }

    #[tokio::test]
    async fn media_body_eof_retries_get_and_discards_partial_bytes() {
        let (url, server) = local_media_server(vec![
            b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\npar",
            b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ncomplete",
        ]).await;
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
        let calls = AtomicUsize::new(0);
        let result = retry_remote_media(Duration::from_secs(5), Duration::ZERO, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            let response = client.get(url.clone()).send().await.map_err(MediaDownloadError::network)?;
            read_remote_media_response(response, url.clone(), 20).await
        }).await.unwrap();
        assert_eq!(result.bytes, b"complete");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(server.await.unwrap(), ["GET", "GET"]);
    }

    #[test]
    fn ranged_media_rejects_shifted_spans_changed_versions_and_oversize_files() {
        use reqwest::header::{HeaderMap, HeaderValue, CONTENT_RANGE, ETAG};
        let range = MediaRange { start: 4, end: 7, etag: Some(HeaderValue::from_static("\"original\"")) };
        let mut headers = HeaderMap::new();
        headers.insert(ETAG, HeaderValue::from_static("\"original\""));
        headers.insert(CONTENT_RANGE, HeaderValue::from_static("bytes 4-7/10"));
        assert_eq!(checked_media_range(&headers, &range, 10).unwrap(), (4, 10));
        for value in ["bytes 0-3/10", "bytes 4-8/10", "bytes 4-7/*", "bytes 4-7/0", "items 4-7/10", "bytes 4-7/11"] {
            headers.insert(CONTENT_RANGE, value.parse().unwrap());
            assert!(checked_media_range(&headers, &range, 10).is_err(), "{value}");
        }
        headers.insert(CONTENT_RANGE, HeaderValue::from_static("bytes 4-7/10"));
        headers.insert(ETAG, HeaderValue::from_static("\"changed\""));
        assert!(checked_media_range(&headers, &range, 10).unwrap_err().message.contains("发生变化"));
        headers.remove(ETAG);
        assert!(checked_media_range(&headers, &range, 10).is_err());
    }

    #[tokio::test]
    async fn ranged_media_keeps_exact_original_bytes_and_rejects_partial_or_full_replacements() {
        let range = MediaRange { start: 4, end: 7, etag: Some("\"original\"".parse().unwrap()) };
        for (response, success) in [
            (&b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 4-7/10\r\nETag: \"original\"\r\nContent-Length: 4\r\nConnection: close\r\n\r\n\x00\x01\xfe\xff"[..], true),
            (&b"HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 4-7/10\r\nETag: \"original\"\r\nConnection: close\r\n\r\npar"[..], false),
            (&b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nfull"[..], false),
        ] {
            let (url, server) = local_media_server(vec![response]).await;
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let response = client.get(url.clone()).send().await.unwrap();
            let result = read_media_range(response, url, &range, 10).await;
            assert_eq!(result.is_ok(), success);
            if let Ok((media, total)) = result {
                assert_eq!(total, 10);
                assert_eq!(media.bytes, [0, 1, 254, 255]);
            }
            assert_eq!(server.await.unwrap(), ["GET"]);
        }
    }

    #[tokio::test]
    async fn persistent_body_eof_stops_after_three_gets_with_a_safe_error() {
        let (url, server) = local_media_server(vec![b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\npar"; 3]).await;
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
        let calls = AtomicUsize::new(0);
        let result = retry_remote_media(Duration::from_secs(5), Duration::ZERO, || async {
            calls.fetch_add(1, Ordering::SeqCst);
            let response = client.get(url.clone()).send().await.map_err(MediaDownloadError::network)?;
            read_remote_media_response(response, url.clone(), 20).await
        }).await;
        assert_eq!(result.err().unwrap(), "媒体下载中断，请重试保存");
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(server.await.unwrap(), ["GET", "GET", "GET"]);
    }

    #[tokio::test]
    async fn media_http_rejections_and_size_limits_fail_without_retry() {
        for (response, limit, expected) in [
            (&b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"[..], 20, "HTTP 403"),
            (&b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"[..], 20, "HTTP 503"),
            (&b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\ncomplete"[..], 4, "文件过大"),
            (&b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n8\r\ncomplete\r\n0\r\n\r\n"[..], 4, "文件过大"),
        ] {
            let (url, server) = local_media_server(vec![response]).await;
            let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
            let calls = AtomicUsize::new(0);
            let result = retry_remote_media(Duration::from_secs(5), Duration::ZERO, || async {
                calls.fetch_add(1, Ordering::SeqCst);
                let response = client.get(url.clone()).send().await.map_err(MediaDownloadError::network)?;
                read_remote_media_response(response, url.clone(), limit).await
            }).await;
            assert!(result.err().unwrap().contains(expected));
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert_eq!(server.await.unwrap(), ["GET"]);
        }
    }

    #[tokio::test]
    async fn media_retry_has_a_total_deadline_and_keeps_private_address_checks() {
        let result = retry_remote_media(Duration::from_millis(20), Duration::ZERO, || std::future::pending::<Result<(), MediaDownloadError>>()).await;
        assert_eq!(result.unwrap_err(), "媒体下载超时，请重试保存");
        let denied = download_remote_media(reqwest::Url::parse("https://127.0.0.1:9/completed.mp4").unwrap(), 20, false).await;
        assert!(denied.err().unwrap().contains("本机或内网"));
    }

    #[test]
    fn media_unknown_errors_do_not_retry_or_disclose_signed_urls() {
        let error = reqwest::Client::new().get("https://cdn.invalid")
            .header("authorization", "Bearer private-secret\ninvalid").build().unwrap_err()
            .with_url(reqwest::Url::parse("https://cdn.invalid/result?token=private-secret&detail=unexpected%20eof").unwrap());
        let failure = MediaDownloadError::network(error);
        assert!(!failure.retryable);
        assert_eq!(failure.message, "媒体下载失败：网络请求未完成");
        assert!(!failure.message.contains("private-secret") && !failure.message.contains("cdn.invalid"));
    }
}

struct DownloadedMedia {
    url: reqwest::Url,
    headers: reqwest::header::HeaderMap,
    bytes: Vec<u8>,
}

fn checked_media_range(headers: &reqwest::header::HeaderMap, requested: &MediaRange, limit: usize) -> Result<(usize, usize), MediaDownloadError> {
    let invalid = || MediaDownloadError::permanent("媒体分段响应无效，请重试保存");
    let value = headers.get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes ")).ok_or_else(invalid)?;
    let (span, total) = value.split_once('/').ok_or_else(invalid)?;
    let (start, end) = span.split_once('-').ok_or_else(invalid)?;
    let start: usize = start.parse().map_err(|_| invalid())?;
    let end: usize = end.parse().map_err(|_| invalid())?;
    let total: usize = total.parse().map_err(|_| invalid())?;
    if total > limit {
        return Err(MediaDownloadError::permanent("生成结果文件过大，无法保存"));
    }
    if total == 0 || start != requested.start || start > end || end != requested.end.min(total - 1) {
        return Err(invalid());
    }
    if let Some(etag) = &requested.etag {
        if headers.get(reqwest::header::ETAG) != Some(etag) {
            return Err(MediaDownloadError::permanent("媒体文件在下载中发生变化，请重试保存"));
        }
    }
    Ok((end - start + 1, total))
}

async fn read_media_range(response: reqwest::Response, url: reqwest::Url, range: &MediaRange, limit: usize) -> Result<(DownloadedMedia, usize), MediaDownloadError> {
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(MediaDownloadError::permanent("媒体分段响应发生变化，请重试保存"));
    }
    let (length, total) = checked_media_range(response.headers(), range, limit)?;
    let media = read_remote_media_response(response, url, length).await?;
    if media.bytes.len() != length {
        return Err(MediaDownloadError { message: "媒体下载中断，请重试保存".into(), retryable: true });
    }
    Ok((media, total))
}

/// Small parallel GETs keep slow provider-CDN streams from restarting an
/// entire video. Every chunk follows the same DNS/redirect checks, and a
/// strong ETag prevents assembling bytes from different versions of a file.
async fn download_video_ranges(url: reqwest::Url, max_bytes: usize, allow_private_network: bool) -> Result<DownloadedMedia, MediaDownloadError> {
    use futures_util::{stream, StreamExt};
    let first = MediaRange { start: 0, end: 65535, etag: None };
    let (response, final_url) = request_remote_media_range(url, allow_private_network, Some(first.clone())).await?;
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return read_remote_media_response(response, final_url, max_bytes).await;
    }
    let (mut media, total) = read_media_range(response, final_url, &first, max_bytes).await?;
    if media.bytes.len() == total {
        return Ok(media);
    }
    let etag = media.headers.get(reqwest::header::ETAG).filter(|v| v.to_str().is_ok_and(|s| s.starts_with('"') && s.ends_with('"'))).cloned();
    let Some(etag) = etag else {
        // Without a stable validator, keep the original single-response path.
        let (response, final_url) = request_public_remote_media(media.url, allow_private_network).await?;
        return read_remote_media_response(response, final_url, max_bytes).await;
    };
    let ranges = (media.bytes.len()..total).step_by(128 * 1024).map(|start| MediaRange { start, end: (start + 128 * 1024 - 1).min(total - 1), etag: Some(etag.clone()) }).collect::<Vec<_>>();
    let origin = media.url.clone();
    let mut pending = stream::iter(ranges).map(|range| {
        let origin = origin.clone();
        async move {
            for attempt in 0..3 {
                let result = async {
                    let (response, final_url) = request_remote_media_range(origin.clone(), allow_private_network, Some(range.clone())).await?;
                    let (part, part_total) = read_media_range(response, final_url, &range, max_bytes).await?;
                    if part_total != total { return Err(MediaDownloadError::permanent("媒体文件在下载中发生变化，请重试保存")); }
                    Ok((range.start, part.bytes))
                }.await;
                match result {
                    Err(error) if error.retryable && attempt < 2 => tokio::time::sleep(Duration::from_millis(200 * (attempt + 1))).await,
                    value => return value,
                }
            }
            unreachable!()
        }
    }).buffer_unordered(8);
    media.bytes.resize(total, 0);
    while let Some(part) = pending.next().await {
        let (start, bytes) = part?;
        media.bytes[start..start + bytes.len()].copy_from_slice(&bytes);
    }
    media.headers.remove(reqwest::header::CONTENT_RANGE);
    media.headers.remove(reqwest::header::TRANSFER_ENCODING);
    media.headers.insert(reqwest::header::CONTENT_LENGTH, total.to_string().parse().map_err(|_| MediaDownloadError::permanent("媒体文件大小无效"))?);
    Ok(media)
}

async fn read_remote_media_response(response: reqwest::Response, url: reqwest::Url, max_bytes: usize) -> Result<DownloadedMedia, MediaDownloadError> {
    if !response.status().is_success() {
        return Err(MediaDownloadError::permanent(format!("下载生成结果失败：HTTP {}", response.status())));
    }
    let (_, headers, bytes) = read_limited_response(response, max_bytes).await.map_err(|error| match error {
        ResponseReadError::TooLarge => MediaDownloadError::permanent("生成结果文件过大，无法保存"),
        ResponseReadError::Network(error) => MediaDownloadError::network(error),
    })?;
    Ok(DownloadedMedia { url, headers, bytes })
}

/// This bounded retry applies only to idempotent media GETs, never model POSTs.
async fn retry_remote_media<T, F, Fut>(total_timeout: Duration, backoff: Duration, mut download: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, MediaDownloadError>>,
{
    tokio::time::timeout(total_timeout, async {
        for attempt in 0..3 {
            match download().await {
                Ok(value) => return Ok(value),
                Err(error) if !error.retryable || attempt == 2 => return Err(error.message),
                Err(_) => tokio::time::sleep(backoff * (attempt + 1)).await,
            }
        }
        unreachable!("the final download attempt returns")
    }).await.map_err(|_| "媒体下载超时，请重试保存".to_string())?
}

async fn download_remote_media(url: reqwest::Url, max_bytes: usize, allow_private_network: bool) -> Result<DownloadedMedia, String> {
    retry_remote_media(Duration::from_secs(180), Duration::from_millis(400), || async {
        let path = url.path().to_ascii_lowercase();
        if [".mp4", ".mov", ".webm"].iter().any(|extension| path.ends_with(extension)) {
            return download_video_ranges(url.clone(), max_bytes, allow_private_network).await;
        }
        let (response, final_url) = request_public_remote_media(url.clone(), allow_private_network).await?;
        read_remote_media_response(response, final_url, max_bytes).await
    }).await
}

pub async fn native_fetch_model_list(
    url: String,
    api_key: String,
) -> Result<serde_json::Value, String> {
    const MAX_MODEL_LIST_BYTES: usize = 4 * 1024 * 1024;
    let parsed = validate_credential_url(&url, "模型列表地址")?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型列表请求：{error}"))?;
    let response = client
        .get(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| model_network_error("读取模型列表失败", error))?;
    let (status, _, bytes) = read_limited_response_bytes(
        response,
        MAX_MODEL_LIST_BYTES,
        "读取模型列表失败",
        "模型列表响应过大，已取消读取",
    )
    .await?;
    let payload: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| format!("模型列表响应格式无效（HTTP {status}）"))?;
    if !status.is_success() {
        let detail = payload
            .get("error")
            .and_then(|error| {
                error
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| error.as_str())
            })
            .or_else(|| payload.get("message").and_then(serde_json::Value::as_str))
            .or_else(|| payload.get("msg").and_then(serde_json::Value::as_str))
            .unwrap_or("请求未成功");
        return Err(format!("读取模型列表失败（HTTP {status}）：{detail}"));
    }
    Ok(payload)
}

/// Credential placement for a provider request.
///
/// Only the one non-Bearer scheme is modelled, so the enum deliberately
/// deserializes from a fixed literal instead of an arbitrary header name.
#[derive(serde::Deserialize)]
pub enum ModelRequestAuth {
    #[serde(rename = "x-goog-api-key")]
    GoogleApiKey,
}

/// Provider protocol headers a caller may set on a proxied request.
///
/// A whitelist rather than passthrough: forwarding arbitrary names would let a
/// caller rewrite `Host`, `Authorization` or `X-Forwarded-*` on a request the
/// server makes with its own credentials. Anthropic-compatible endpoints
/// (MiniMax among them) require `anthropic-version` and reject the request
/// without it.
const ALLOWED_PROVIDER_HEADERS: &[&str] = &["anthropic-version"];

pub type ExtraHeaders = Option<std::collections::HashMap<String, String>>;

fn apply_extra_headers(
    mut request: reqwest::RequestBuilder,
    headers: ExtraHeaders,
) -> Result<reqwest::RequestBuilder, String> {
    for (name, value) in headers.into_iter().flatten() {
        let lowered = name.trim().to_ascii_lowercase();
        if !ALLOWED_PROVIDER_HEADERS.contains(&lowered.as_str()) {
            return Err(format!("不允许透传请求头：{name}"));
        }
        request = request.header(lowered, value);
    }
    Ok(request)
}

fn apply_credential(
    request: reqwest::RequestBuilder,
    api_key: &str,
    auth: Option<ModelRequestAuth>,
) -> reqwest::RequestBuilder {
    match auth {
        Some(ModelRequestAuth::GoogleApiKey) => request.header("x-goog-api-key", api_key),
        None => request.header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}")),
    }
}

fn model_network_failure_reason(
    error: &(dyn std::error::Error + 'static),
    timed_out: bool,
    dns: bool,
    connect: bool,
) -> &'static str {
    let (mut timeout, mut resolution, mut tls, mut refused, mut interrupted) =
        (timed_out, dns, false, false, false);
    let mut source = Some(error);
    // Inspect causes for classification only. Their text may contain URLs or
    // credentials and must never be included in the returned error.
    for _ in 0..16 {
        let Some(cause) = source else { break };
        if let Some(io) = cause.downcast_ref::<std::io::Error>() {
            use std::io::ErrorKind;
            timeout |= io.kind() == ErrorKind::TimedOut;
            refused |= io.kind() == ErrorKind::ConnectionRefused;
            interrupted |= matches!(io.kind(), ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted | ErrorKind::BrokenPipe | ErrorKind::UnexpectedEof | ErrorKind::NotConnected);
        }
        if !cause.is::<reqwest::Error>() {
            let message = cause.to_string().to_ascii_lowercase();
            resolution |= ["dns error", "dns resolution failed", "failed to lookup address information", "name or service not known", "nodename nor servname"].iter().any(|part| message.contains(part));
            tls |= ["tls handshake", "invalid peer certificate", "certificate verify failed", "certificate verification failed", "invalid certificate", "unknownissuer"].iter().any(|part| message.contains(part));
            refused |= message.contains("connection refused");
            interrupted |= ["connection reset", "connection aborted", "connection closed", "broken pipe", "unexpected eof"].iter().any(|part| message.contains(part));
        }
        source = cause.source();
    }
    if timeout { "请求超时" }
    else if resolution { "域名解析失败" }
    else if tls { "TLS 或证书验证失败" }
    else if refused { "连接被拒绝" }
    else if interrupted { "网络连接中断" }
    else if connect { "无法连接模型服务" }
    else { "网络请求未完成" }
}

fn model_network_error(prefix: &str, error: reqwest::Error) -> String {
    let reason = model_network_failure_reason(&error, error.is_timeout(), error.is_dns(), error.is_connect());
    // No response does not establish whether a provider received or billed the
    // request. Do not retry here or expose the original URL/debug payload.
    format!("{prefix}：{reason}；未收到 HTTP 响应。")
}

pub async fn native_model_json_post(
    url: String,
    api_key: String,
    body: serde_json::Value,
    auth: Option<ModelRequestAuth>,
    headers: ExtraHeaders,
) -> Result<serde_json::Value, String> {
    post_model_json(&url, &api_key, body, auth, headers).await
}

async fn post_model_json(
    url: &str,
    api_key: &str,
    body: serde_json::Value,
    auth: Option<ModelRequestAuth>,
    headers: ExtraHeaders,
) -> Result<serde_json::Value, String> {
    let parsed = validate_credential_url(url, "模型请求地址")?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let request = apply_extra_headers(apply_credential(client.post(parsed), api_key, auth), headers)?;
    let response = request
        .header(reqwest::header::ACCEPT, "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| model_network_error("模型请求失败", error))?;
    read_model_json_response(response).await
}

/// Opens a provider request and hands the response back unread.
///
/// Streaming cannot go through `post_model_json`, which buffers the whole body
/// under a 16 MiB cap. The caller forwards the status, content type and body
/// straight to the browser so server-sent events arrive as they are produced.
/// The status is deliberately NOT checked here: a provider error body is a
/// normal streaming payload, and the client reports it with more context than a
/// generic message could.
pub async fn native_model_proxy_post(
    url: String,
    api_key: String,
    body: serde_json::Value,
    auth: Option<ModelRequestAuth>,
    headers: ExtraHeaders,
) -> Result<reqwest::Response, String> {
    let parsed = validate_credential_url(&url, "模型请求地址")?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let request = apply_extra_headers(apply_credential(client.post(parsed), &api_key, auth), headers)?;
    request
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|error| model_network_error("模型请求失败", error))
}

pub async fn native_model_raw_json_post(
    url: String,
    api_key: String,
    body: String,
) -> Result<String, String> {
    post_model_raw_json(&url, &api_key, &body).await
}

/// Sends a pre-serialized body so integers that exceed the browser JSON number
/// range reach the provider unchanged.
async fn post_model_raw_json(url: &str, api_key: &str, body: &str) -> Result<String, String> {
    let parsed = validate_credential_url(url, "模型请求地址")?;
    serde_json::from_str::<serde_json::Value>(body).map_err(|_| "模型请求 JSON 无效".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .post(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body.to_string())
        .send()
        .await
        .map_err(|error| model_network_error("模型请求失败", error))?;
    read_model_json_text_response(response).await
}

pub async fn native_model_multipart_post(
    url: String,
    api_key: String,
    file_field: String,
    file_name: String,
    mime_type: String,
    data_base64: String,
    fields: HashMap<String, String>,
) -> Result<String, String> {
    post_model_multipart(
        &url,
        &api_key,
        &file_field,
        &file_name,
        &mime_type,
        &data_base64,
        fields,
    )
    .await
}

async fn post_model_multipart(
    url: &str,
    api_key: &str,
    file_field: &str,
    file_name: &str,
    mime_type: &str,
    data_base64: &str,
    fields: HashMap<String, String>,
) -> Result<String, String> {
    const MAX_MODEL_UPLOAD_BYTES: usize = 64 * 1024 * 1024;
    let parsed = validate_credential_url(url, "模型请求地址")?;
    if file_field.trim().is_empty() || file_name.trim().is_empty() {
        return Err("模型上传文件信息不完整".into());
    }
    let file_bytes = BASE64
        .decode(data_base64.trim())
        .map_err(|_| "模型上传文件无法解码".to_string())?;
    if file_bytes.len() > MAX_MODEL_UPLOAD_BYTES {
        return Err("模型上传文件过大，已取消请求".into());
    }
    let file_part = reqwest::multipart::Part::bytes(file_bytes)
        .file_name(file_name.trim().to_string())
        .mime_str(mime_type.trim())
        .map_err(|_| "模型上传文件类型无效".to_string())?;
    let mut form = reqwest::multipart::Form::new().part(file_field.trim().to_string(), file_part);
    for (name, value) in fields {
        if !name.trim().is_empty() {
            form = form.text(name, value);
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .post(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .multipart(form)
        .send()
        .await
        .map_err(|error| model_network_error("模型请求失败", error))?;
    read_model_json_text_response(response).await
}

pub async fn native_model_json_get(url: String, api_key: String) -> Result<serde_json::Value, String> {
    let parsed = validate_credential_url(&url, "模型请求地址")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .get(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| model_network_error("模型请求失败", error))?;
    read_model_json_response(response).await
}

pub async fn native_model_json_delete(url: String, api_key: String) -> Result<serde_json::Value, String> {
    let parsed = validate_credential_url(&url, "模型请求地址")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法创建模型请求：{error}"))?;
    let response = client
        .delete(parsed)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| model_network_error("模型请求失败", error))?;
    read_model_json_response(response).await
}

async fn read_model_json_response(
    response: reqwest::Response,
) -> Result<serde_json::Value, String> {
    let raw = read_model_json_text_response(response).await?;
    serde_json::from_str(&raw).map_err(|_| "模型响应格式无效".to_string())
}

async fn read_model_json_text_response(response: reqwest::Response) -> Result<String, String> {
    const MAX_MODEL_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
    let (status, _, bytes) = read_limited_response_bytes(
        response,
        MAX_MODEL_RESPONSE_BYTES,
        "读取模型响应失败",
        "模型响应过大，已取消读取",
    )
    .await?;
    let payload: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| format!("模型响应格式无效（HTTP {status}）"))?;
    if !status.is_success() {
        let detail = payload
            .get("error")
            .and_then(|error| {
                error
                    .get("message")
                    .and_then(serde_json::Value::as_str)
                    .or_else(|| error.as_str())
            })
            .or_else(|| {
                payload
                    .get("base_resp")
                    .and_then(|base| base.get("status_msg"))
                    .and_then(serde_json::Value::as_str)
            })
            .or_else(|| payload.get("message").and_then(serde_json::Value::as_str))
            .or_else(|| payload.get("msg").and_then(serde_json::Value::as_str))
            .unwrap_or("请求未成功");
        return Err(format!("模型请求失败（HTTP {status}）：{detail}"));
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| format!("模型响应格式无效（HTTP {status}）"))
}

/// Downloads a provider result and hands the bytes to native media storage.
/// Fetches a remote URL and returns its bytes plus the reported content type.
///
/// Used for provider results the browser cannot read cross-origin. Applies the
/// same SSRF guard, redirect policy and size cap as the media importer; the only
/// difference is that it persists nothing, because the caller decides where the
/// bytes belong.
pub async fn native_fetch_remote_bytes(
    url: String,
    max_bytes: Option<usize>,
    allow_private_network: bool,
) -> Result<(Option<String>, Vec<u8>), String> {
    const MAX_REMOTE_MEDIA_BYTES: usize = 256 * 1024 * 1024;
    let limit = max_bytes
        .filter(|value| *value > 0)
        .unwrap_or(MAX_REMOTE_MEDIA_BYTES)
        .min(MAX_REMOTE_MEDIA_BYTES);
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "媒体地址无效".to_string())?;
    let DownloadedMedia { headers, bytes, .. } = download_remote_media(parsed, limit, allow_private_network).await?;
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase());
    Ok((content_type, bytes))
}

pub async fn native_fetch_remote_media(
    storage: State<Arc<NativeStorage>>,
    url: String,
    bucket: String,
    key: String,
    expected_sha256: Option<String>,
    max_bytes: Option<usize>,
    allow_private_network: Option<bool>,
) -> Result<NativeMediaRecord, String> {
    const MAX_REMOTE_MEDIA_BYTES: usize = 256 * 1024 * 1024;
    let max_remote_media_bytes = max_bytes
        .filter(|value| *value > 0)
        .unwrap_or(MAX_REMOTE_MEDIA_BYTES)
        .min(MAX_REMOTE_MEDIA_BYTES);
    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "媒体地址无效".to_string())?;
    let DownloadedMedia { url: final_url, headers, bytes } = download_remote_media(parsed, max_remote_media_bytes, allow_private_network.unwrap_or(false)).await?;
    let reported_mime_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase());
    verify_remote_media_checksum(&bytes, expected_sha256.as_deref())?;
    let mime_type =
        normalize_remote_media_type(reported_mime_type.as_deref(), &final_url, &key, &bytes)
            .ok_or_else(|| "生成结果媒体格式无法识别".to_string())?;
    storage::save_remote_media(&storage, bucket, key, mime_type, &bytes)
}

fn verify_remote_media_checksum(bytes: &[u8], expected_sha256: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected_sha256
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    if expected.len() != 64
        || !expected
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("媒体文件校验值无效".into());
    }
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != expected.to_ascii_lowercase() {
        return Err("媒体文件校验失败，已停止保存".into());
    }
    Ok(())
}

/// Trusts the bytes over the `Content-Type` header, then the URL extension.
///
/// The declared type is only accepted when it agrees with the media family the
/// storage key belongs to, so a mislabelled or hostile response cannot smuggle
/// a different media kind past the storage MIME allowlist.
fn normalize_remote_media_type(
    reported: Option<&str>,
    url: &reqwest::Url,
    key: &str,
    bytes: &[u8],
) -> Option<String> {
    let key_family = key.split_once(':').map(|(prefix, _)| prefix).unwrap_or(key);
    let detected = sniff_media_type(bytes, key_family);
    if let Some(mime_type) = detected {
        return Some(mime_type.to_string());
    }
    if let Some(mime_type) = reported.filter(|value| media_type_matches_key(value, key_family)) {
        return Some(mime_type.to_string());
    }
    infer_media_type_from_url(url)
        .filter(|value| media_type_matches_key(value, key_family))
        .map(str::to_string)
}

fn infer_media_type_from_url(url: &reqwest::Url) -> Option<&'static str> {
    match url
        .path()
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "avif" => Some("image/avif"),
        "mp4" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/x-m4a"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        _ => None,
    }
}

fn media_type_matches_key(mime_type: &str, key_family: &str) -> bool {
    let family = if key_family.starts_with("image") {
        "image/"
    } else if key_family.starts_with("video") {
        "video/"
    } else if key_family.starts_with("audio") {
        "audio/"
    } else {
        return matches!(
            mime_type.split_once('/').map(|(family, _)| family),
            Some("image" | "video" | "audio")
        );
    };
    mime_type.starts_with(family)
}

fn sniff_media_type(bytes: &[u8], key_family: &str) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Some("video/webm");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        if key_family.starts_with("audio") {
            return Some("audio/mp4");
        }
        if &bytes[8..10] == b"qt" {
            return Some("video/quicktime");
        }
        return Some("video/mp4");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("audio/wav");
    }
    if bytes.starts_with(b"OggS") {
        return Some("audio/ogg");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("audio/flac");
    }
    if bytes.starts_with(b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
    {
        return Some("audio/mpeg");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        is_public_remote_address, select_remote_media_addresses, validate_credential_url,
        model_network_error, model_network_failure_reason, ModelRequestAuth,
    };
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

    #[derive(Debug)]
    struct NetworkCause {
        message: &'static str,
        source: Option<std::io::Error>,
    }
    impl std::fmt::Display for NetworkCause {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str(self.message)
        }
    }
    impl std::error::Error for NetworkCause {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            self.source.as_ref().map(|source| source as _)
        }
    }

    #[test]
    fn model_network_errors_classify_causes_without_disclosing_their_text() {
        use std::io::ErrorKind;
        for (kind, detail, expected) in [
            (ErrorKind::Other, "dns error: failed to resolve https://provider.invalid?api_key=private-secret", "域名解析失败"),
            (ErrorKind::Other, "invalid peer certificate: UnknownIssuer Bearer private-secret", "TLS 或证书验证失败"),
            (ErrorKind::ConnectionRefused, "https://provider.invalid?api_key=private-secret", "连接被拒绝"),
            (ErrorKind::Other, "tcp connect error: Connection refused", "连接被拒绝"),
            (ErrorKind::ConnectionReset, "private-secret", "网络连接中断"),
            (ErrorKind::UnexpectedEof, "private-secret", "网络连接中断"),
            (ErrorKind::Other, "connection closed before message completed", "网络连接中断"),
            (ErrorKind::TimedOut, "private-secret", "请求超时"),
        ] {
            let cause = NetworkCause { message: "client error (Connect)", source: Some(std::io::Error::new(kind, detail)) };
            let reason = model_network_failure_reason(&cause, false, false, true);
            assert_eq!(reason, expected);
            assert!(!reason.contains("private-secret") && !reason.contains("provider.invalid"));
        }
    }

    #[test]
    fn model_network_errors_use_request_flags_and_keep_uncertain_failures_generic() {
        let cause = NetworkCause { message: "request failed", source: None };
        assert_eq!(model_network_failure_reason(&cause, true, false, false), "请求超时");
        assert_eq!(model_network_failure_reason(&cause, false, true, true), "域名解析失败");
        assert_eq!(model_network_failure_reason(&cause, false, false, true), "无法连接模型服务");
        assert_eq!(model_network_failure_reason(&cause, false, false, false), "网络请求未完成");
    }

    #[test]
    fn model_network_error_omits_credential_urls_and_does_not_claim_request_delivery() {
        // A malformed header creates an actual reqwest error without sending
        // any traffic. URLs, headers and arbitrary causes are never displayed.
        let error = reqwest::Client::new()
            .post("https://provider.invalid")
            .header("authorization", "Bearer private-secret\ninvalid")
            .build().unwrap_err()
            .with_url(reqwest::Url::parse("https://provider.invalid/images?api_key=private-secret#private-fragment").unwrap());
        let message = model_network_error("模型请求失败", error);
        assert_eq!(message, "模型请求失败：网络请求未完成；未收到 HTTP 响应。");
        for private in ["private-secret", "provider.invalid", "api_key", "private-fragment", "Bearer", "未发送", "未计费"] {
            assert!(!message.contains(private));
        }
    }

    #[test]
    fn credential_urls_require_https_except_for_loopback_development() {
        assert!(validate_credential_url("https://api.example.com/v1", "模型请求地址").is_ok());
        assert!(validate_credential_url("http://127.0.0.1:11434/v1", "模型请求地址").is_ok());
        assert!(validate_credential_url("http://localhost:11434/v1", "模型请求地址").is_ok());
        assert!(validate_credential_url("http://api.example.com/v1", "模型请求地址").is_err());
        assert!(
            validate_credential_url("https://user:pass@api.example.com/v1", "模型请求地址")
                .is_err()
        );
    }

    #[test]
    fn remote_media_rejects_private_and_reserved_addresses() {
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            127, 0, 0, 1
        ))));
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            10, 0, 0, 1
        ))));
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            169, 254, 169, 254
        ))));
        assert!(!is_public_remote_address(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            198, 18, 0, 1
        ))));
        assert!(is_public_remote_address(IpAddr::V4(Ipv4Addr::new(
            1, 1, 1, 1
        ))));
    }

    #[test]
    fn remote_media_allows_all_non_public_addresses_only_when_enabled() {
        let fake_ip = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(198, 18, 0, 1)), 443);
        assert_eq!(
            select_remote_media_addresses(vec![fake_ip], true).unwrap(),
            vec![fake_ip]
        );
        assert!(select_remote_media_addresses(vec![fake_ip], false).is_err());

        let private = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 64, 0, 1)), 443);
        assert_eq!(
            select_remote_media_addresses(vec![private], true).unwrap(),
            vec![private]
        );

        let loopback = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 443);
        assert_eq!(
            select_remote_media_addresses(vec![loopback], true).unwrap(),
            vec![loopback]
        );
    }

    #[test]
    fn remote_media_uses_only_public_results_from_mixed_dns_answers() {
        let private = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)), 443);
        let public = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)), 443);
        assert_eq!(
            select_remote_media_addresses(vec![private, public], false).unwrap(),
            vec![public]
        );
    }

    #[test]
    fn model_json_auth_rejects_arbitrary_header_names() {
        assert!(serde_json::from_str::<ModelRequestAuth>(r#""x-goog-api-key""#).is_ok());
        assert!(serde_json::from_str::<ModelRequestAuth>(r#""x-custom-header""#).is_err());
    }
}

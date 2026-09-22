use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};

/// The project's published minisign key. Verification has to happen here rather
/// than in the browser: WebCrypto has no minisign verify and still lacks
/// Ed25519 on several engines, so a client-side check would mean shipping a WASM
/// verifier. The key is public and the signature covers public artifacts, so
/// moving the check server-side changes nothing about the trust model.
const PUBLISHER_MINISIGN_PUBLIC_KEY: &str =
    "RWSF/lzGZohk+sJRybkcDaxqLrkxOcM2sw47TT2WAXqqJ8kHZphSxVC3";

const MAX_SIGNATURE_BYTES: usize = 16 * 1024;
const MAX_SIGNED_PAYLOAD_BYTES: usize = 8 * 1024 * 1024;

fn verify_publisher_payload(payload: &[u8], signature_text: &str) -> Result<(), String> {
    let public_key = minisign_verify::PublicKey::from_base64(PUBLISHER_MINISIGN_PUBLIC_KEY)
        .map_err(|_| "发布者公钥无效".to_string())?;
    let trimmed = signature_text.trim();
    // Accept both the base64-wrapped envelope the release tooling emits and raw
    // `untrusted comment:` minisign text.
    let normalized = if trimmed.starts_with("untrusted comment:") {
        trimmed.to_string()
    } else {
        String::from_utf8(
            BASE64
                .decode(trimmed)
                .map_err(|_| "发布签名格式无效".to_string())?,
        )
        .map_err(|_| "发布签名格式无效".to_string())?
    };
    let signature = minisign_verify::Signature::decode(&normalized)
        .map_err(|_| "发布签名格式无效".to_string())?;
    public_key
        .verify(payload, &signature, false)
        .map_err(|_| "发布签名校验失败".to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    payload_base64: String,
    signature: String,
}

#[derive(Serialize)]
pub struct VerifyResponse {
    valid: bool,
}

/// Reports whether a publisher payload matches its signature. Failures carry the
/// specific Chinese reason so the importing UI can tell a bad signature from a
/// malformed one.
pub async fn verify(Json(request): Json<VerifyRequest>) -> Response {
    if request.signature.len() > MAX_SIGNATURE_BYTES {
        return (StatusCode::BAD_REQUEST, "发布签名文件过大").into_response();
    }
    let payload = match BASE64.decode(request.payload_base64) {
        Ok(payload) => payload,
        Err(_) => return (StatusCode::BAD_REQUEST, "发布内容无法解码").into_response(),
    };
    if payload.len() > MAX_SIGNED_PAYLOAD_BYTES {
        return (StatusCode::BAD_REQUEST, "发布内容过大").into_response();
    }
    match verify_publisher_payload(&payload, &request.signature) {
        Ok(()) => Json(VerifyResponse { valid: true }).into_response(),
        Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::{verify_publisher_payload, BASE64};
    use base64::Engine;

    const TAURI_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTRi9sekdab2hrK2dDOEdSeFdNNXAxVjVia1hvbHJtTmYyVTkyVlFGQzBjZjlCeW1BcEQ1Q055R3lVVWh6TExXbWNsT28zVWhDK2VyaVRZZlUzUExobm55OENoMk01MGdBPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg2OTU0NjkzCWZpbGU6d29ya2Zsb3dnZW5lcmF0b3ItcHVibGlzaGVyLXNpZ25hdHVyZS1maXh0dXJlLnR4dApFUE9KZWdxWDk4d3JqYUJMZ0tSNVlWbVdKU3hWR2pGUGd0MVRYb1BUYTRqODdDOG5uNjRDTDBxalJiNjRyeVZNbWpmNlFVWkZJUHdtSnBscjNyS2ZDUT09Cg==";

    #[test]
    fn verifies_tauri_base64_signature_envelopes_and_raw_minisign_text() {
        let payload = b"v0.1.0\n";
        verify_publisher_payload(payload, TAURI_SIGNATURE).unwrap();
        let raw_signature = String::from_utf8(BASE64.decode(TAURI_SIGNATURE).unwrap()).unwrap();
        verify_publisher_payload(payload, &raw_signature).unwrap();
        assert!(verify_publisher_payload(b"v0.1.1\n", TAURI_SIGNATURE).is_err());
    }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackHostname(hostname: string) {
    return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function normalizeCredentialUrl(value: string, label = "接口地址") {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error(`${label}格式不正确`);
    }
    if (url.username || url.password) throw new Error(`${label}不能在网址中包含账号或密码`);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
        throw new Error(`${label}必须使用 HTTPS；本机 localhost 可使用 HTTP`);
    }
    return url.toString();
}

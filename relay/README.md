# Seedance reference-video relay

Seedance video generation accepts a public video URL or an Ark `asset://` ID, not a local video or video Base64. This service gives the desktop app a short-lived HTTPS URL for local MP4/MOV references. The returned URL is random and readable by anyone who possesses it, including the provider. Videos expire after 48 hours and are deleted by hourly cleanup. The service has a 200 MiB per-video limit, a 4 GiB total storage quota, and keeps 512 MiB of disk free. Custom uploads require a bearer token. The optional public upload endpoint is disabled by default; when enabled, it permits 12 attempts per client IP per hour, 1 GiB per IP per day, and 2 GiB total per day. Quotas persist across restarts; IP quota records expire after one day.

Run `seedance_media_relay.py` behind an HTTPS reverse proxy on a loopback-only port. Set these environment variables outside the repository:

```text
WG_RELAY_UPLOAD_TOKEN=<random secret of at least 32 characters>
WG_RELAY_PUBLIC_BASE=https://your-domain.example/seedance-media
WG_RELAY_PORT=9014
WG_RELAY_DATA_DIR=/var/lib/workflowgenerator-seedance-relay
WG_RELAY_PUBLIC_UPLOADS=0
WG_RELAY_TRUST_PROXY_IP=0
```

The included systemd unit expects the script at `/opt/workflowgenerator-seedance-relay/seedance_media_relay.py` and its private environment file at `/etc/workflowgenerator-seedance-relay/env`. Adjust those paths if needed. Restrict the environment file to the service administrator (`0600`). A reverse proxy can mount `/seedance-media/` onto `http://127.0.0.1:9014/`, with a 210 MiB request-body limit for that location. To offer the official endpoint, set `WG_RELAY_PUBLIC_UPLOADS=1`; also overwrite `X-Real-IP` with the proxy's `$remote_addr` and set `WG_RELAY_TRUST_PROXY_IP=1` so per-IP limits cannot be forged. Add reverse-proxy request and connection limits and disable access logging for the media path to avoid recording capability URLs. Keep the loopback listener private.

For Nginx, put these zones in the `http` context. Empty keys leave media reads and preflight requests unrestricted by the upload limits:

```nginx
map $request_method $seedance_upload_ip { default ""; PUT $binary_remote_addr; }
map $request_method $seedance_upload_global { default ""; PUT $server_name; }
limit_conn_zone $seedance_upload_ip zone=seedance_upload_ip:1m;
limit_conn_zone $seedance_upload_global zone=seedance_upload_global:1m;
limit_req_zone $seedance_upload_ip zone=seedance_upload_rate:1m rate=12r/m;
```

Apply the following directives inside the HTTPS server's `/seedance-media/` location, in addition to its existing proxy settings. Streaming the request body prevents Nginx from accepting a whole upload before the relay can enforce its quotas:

```nginx
proxy_request_buffering off;
limit_conn seedance_upload_ip 2;
limit_conn seedance_upload_global 8;
limit_req zone=seedance_upload_rate burst=6 nodelay;
limit_req_status 429;
limit_conn_status 429;
proxy_set_header X-Real-IP $remote_addr;
access_log off;
```

In the desktop app, open **本地与网络 → Seedance 参考视频上传** and choose **官方服务器** or **自定义服务器**. Custom servers require their HTTPS base URL and upload token; config exports remove the token. Local videos are uploaded only when a Seedance task is submitted; remote HTTPS and Ark asset references skip the relay.

Test the service locally with `python3 -m unittest discover -s relay -p 'test_*.py'`.

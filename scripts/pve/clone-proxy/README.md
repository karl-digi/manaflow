# PVE LXC clone serialization proxy

A lightweight Go reverse proxy that serializes Proxmox VE LXC clone requests (POST `/api2/json/nodes/<node>/lxc/<vmid>/clone`) to avoid storage/template locks when multiple sandboxes are created concurrently. All other API traffic passes through untouched.

## Build

```bash
cd /opt/pve-clone-proxy  # or any checkout path
GO111MODULE=on go build -o pve-clone-proxy ./scripts/pve/clone-proxy
```

## Configuration

Environment variables (optional):

- `CLONE_PROXY_LISTEN` (default `127.0.0.1:8081`)
- `CLONE_PROXY_TARGET` (default `$PVE_API_URL` or `https://127.0.0.1:8006`)
- `CLONE_PROXY_POLL_INTERVAL` (default `2s`)
- `CLONE_PROXY_POLL_TIMEOUT` (default `15m`)
- `CLONE_PROXY_REQUEST_TIMEOUT` (default `30s` per upstream HTTP request)
- `CLONE_PROXY_QUEUE_SIZE` (default `100` pending clone requests before 503)
- `CLONE_PROXY_SKIP_TLS_VERIFY` (`true` to skip upstream TLS verification)

Create `/etc/default/pve-clone-proxy` to persist settings, e.g.:

```
CLONE_PROXY_LISTEN="127.0.0.1:8081"
CLONE_PROXY_TARGET="https://127.0.0.1:8006"
CLONE_PROXY_SKIP_TLS_VERIFY="true"
CLONE_PROXY_POLL_INTERVAL="2s"
CLONE_PROXY_POLL_TIMEOUT="15m"
CLONE_PROXY_REQUEST_TIMEOUT="30s"
CLONE_PROXY_QUEUE_SIZE="100"
```

Behavior:
- Clone requests are placed onto a bounded in-memory queue (503 if full) and processed one at a time.
- The proxy waits for the PVE task to finish polling before releasing the queue slot; the client receives the original clone response after polling completes.

## Systemd

Install the binary to `/usr/local/bin/pve-clone-proxy`, place the service unit, then enable:

```bash
sudo install -m755 pve-clone-proxy /usr/local/bin/pve-clone-proxy
sudo install -m644 scripts/pve/clone-proxy/pve-clone-proxy.service /etc/systemd/system/pve-clone-proxy.service
sudo systemctl daemon-reload
sudo systemctl enable --now pve-clone-proxy
```

## Caddy

Example Caddyfile snippet to route clone calls through the proxy while leaving other API traffic direct to PVE:

```
pve.example.com {
    handle_path /api2/json/nodes/*/lxc/*/clone* {
        reverse_proxy 127.0.0.1:8081
    }

    reverse_proxy 127.0.0.1:8006
}
```

Update the site label to match your TLS hostname. If easier, point all PVE API traffic at the proxy.

#!/usr/bin/env bash
# Installs and updates Tactful on a Linux VM. Run it from the project folder:
#
#   sudo ./setup_service.sh                       first time, and every time you update
#   sudo DOMAIN=chat.example.com ./setup_service.sh   also sets up Caddy for HTTPS on that domain
#
# Behind an nginx you already run, under a path such as /tactful/ (no Caddy):
#
#   sudo SERVICE_NAME=idea-tactful PORT=8601 BASE_PATH=/tactful/ \
#        NGINX_SNIPPET=/etc/nginx/max.d/tactful.conf ./setup_service.sh
#
#   It writes that one location file plus a rate limit zone in /etc/nginx/conf.d/, checks
#   nginx -t, and removes both again if the check fails. Your server block must include
#   the snippet folder (for example: include /etc/nginx/max.d/*.conf;).
#
# Running it again pulls in your changes, rebuilds, and restarts the service.
# Logs:  journalctl -u <service>.service -f   (default tactful; a size limited copy is also in logs/tactful.log)
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this with sudo." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
# The service runs as whoever owns the project folder, so it can read and write it.
RUN_USER="${SERVICE_USER:-$(stat -c %U "$ROOT")}"
RUN_GROUP="$(id -gn "$RUN_USER")"
SERVICE="${SERVICE_NAME:-tactful}"
NODE_MAJOR=24

as_user() { sudo -u "$RUN_USER" -H env PATH="$PATH" "$@"; }

if [[ -d .git && "${GIT_PULL:-true}" == true ]]; then
  echo "==> Latest code"
  # Fast forward only, so local changes are never thrown away. Set GIT_PULL=false to skip.
  as_user git pull --ff-only || echo "    could not fast forward, building what is here"
fi

echo "==> Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt $NODE_MAJOR ]]; then
  if command -v apt-get >/dev/null; then
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null; then
    curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    dnf install -y nodejs
  else
    echo "Install Node.js ${NODE_MAJOR} or newer by hand, then run this again." >&2
    exit 1
  fi
fi
echo "    node $(node -v)"

echo "==> Settings"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "    created .env from .env.example (REWRITER=fake until you add a provider key)"
fi
chown "$RUN_USER:$RUN_GROUP" .env
chmod 600 .env
set_env() { # set_env KEY VALUE  (adds or replaces the line)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

[[ -n "${PORT:-}" ]] && set_env PORT "$PORT"
# Behind a local proxy, trust only the proxy on this machine for the client address.
[[ -n "${NGINX_SNIPPET:-}" ]] && set_env TRUST_PROXY 127.0.0.1

echo "==> Dependencies and build"
as_user npm ci
as_user npm run build
mkdir -p data logs
chown -R "$RUN_USER:$RUN_GROUP" data logs

echo "==> Service"
NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Tactful (${SERVICE})
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${ROOT}
ExecStart=${NODE_BIN} --env-file=${ROOT}/.env ${ROOT}/dist/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT

if [[ -n "${DOMAIN:-}" ]]; then
  echo "==> Caddy for ${DOMAIN}"
  if ! command -v caddy >/dev/null; then
    if command -v apt-get >/dev/null; then
      apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
      curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -y
      apt-get install -y caddy
    else
      echo "Install Caddy by hand (https://caddyserver.com/docs/install), then run this again." >&2
      exit 1
    fi
  fi
  PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
  cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    encode gzip
    reverse_proxy 127.0.0.1:${PORT:-3000}
}
CADDY
  set_env TRUST_PROXY true
  systemctl enable caddy
  systemctl reload caddy || systemctl restart caddy
fi

if [[ -n "${NGINX_SNIPPET:-}" ]]; then
  BASE="${BASE_PATH:-/tactful/}"
  [[ "$BASE" == /*/ ]] || { echo "BASE_PATH must start and end with a slash, like /tactful/" >&2; exit 1; }
  APP_PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"
  ZONE="${SERVICE//-/_}"
  ZONE_FILE="/etc/nginx/conf.d/${SERVICE}-limits.conf"
  echo "==> nginx: ${BASE} -> 127.0.0.1:${APP_PORT}"
  grep -qE 'include\s+/etc/nginx/conf\.d/\*\.conf' /etc/nginx/nginx.conf || { echo "nginx.conf does not include conf.d, so the rate limit zone can't be added. Nothing changed." >&2; exit 1; }
  mkdir -p "$(dirname "$NGINX_SNIPPET")"
  had_snippet=false; had_zone=false
  [[ -f "$NGINX_SNIPPET" ]] && { cp "$NGINX_SNIPPET" "$NGINX_SNIPPET.bak"; had_snippet=true; }
  [[ -f "$ZONE_FILE" ]] && { cp "$ZONE_FILE" "$ZONE_FILE.bak"; had_zone=true; }
  cat > "$ZONE_FILE" <<NGINX
# ${SERVICE}: rate limit zone, used by ${NGINX_SNIPPET}
limit_req_zone \$binary_remote_addr zone=${ZONE}:10m rate=10r/s;
NGINX
  cat > "$NGINX_SNIPPET" <<NGINX
# ${SERVICE}: written by setup_service.sh in ${ROOT}
location = ${BASE%/} { return 301 ${BASE}; }
location ${BASE} {
    limit_req zone=${ZONE} burst=40 nodelay;
    limit_req_status 429;
    client_max_body_size 32k;
    proxy_pass http://127.0.0.1:${APP_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Connection "";
    # Live updates are a long lived event stream
    proxy_buffering off;
    proxy_read_timeout 1h;
}
NGINX
  if nginx -t 2>/tmp/${SERVICE}-nginx-test.log; then
    rm -f "$NGINX_SNIPPET.bak" "$ZONE_FILE.bak"
    systemctl reload nginx
  else
    cat /tmp/${SERVICE}-nginx-test.log >&2
    if $had_snippet; then mv "$NGINX_SNIPPET.bak" "$NGINX_SNIPPET"; else rm -f "$NGINX_SNIPPET"; fi
    if $had_zone; then mv "$ZONE_FILE.bak" "$ZONE_FILE"; else rm -f "$ZONE_FILE"; fi
    echo "nginx -t failed, so the nginx files were put back as they were." >&2
    exit 1
  fi
fi

systemctl daemon-reload
systemctl enable "${SERVICE}.service"
systemctl restart "${SERVICE}.service"

echo "==> Check"
PORT="$(grep -E '^PORT=' .env | cut -d= -f2 || true)"
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    echo "    up. Logs: journalctl -u ${SERVICE}.service -f"
    exit 0
  fi
  sleep 1
done
echo "The service did not come up. Look at: journalctl -u ${SERVICE}.service -n 50" >&2
exit 1

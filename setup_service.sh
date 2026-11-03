#!/usr/bin/env bash
# Installs and updates Tactful on a Linux VM. Run it from the project folder:
#
#   sudo ./setup_service.sh                       first time, and every time you update
#   sudo DOMAIN=chat.example.com ./setup_service.sh   also sets up Caddy for HTTPS on that domain
#
# Running it again pulls in your changes, rebuilds, and restarts the service.
# Logs:  journalctl -u tactful.service -f     (a size limited copy is also in logs/tactful.log)
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
SERVICE=tactful
NODE_MAJOR=24

as_user() { sudo -u "$RUN_USER" -H env PATH="$PATH" "$@"; }

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

echo "==> Dependencies and build"
as_user npm ci
as_user npm run build
mkdir -p data logs
chown -R "$RUN_USER:$RUN_GROUP" data logs

echo "==> Service"
NODE_BIN="$(command -v node)"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Tactful
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

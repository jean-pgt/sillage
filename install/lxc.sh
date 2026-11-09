#!/bin/bash
# Installe Sillage dans un conteneur LXC Debian 12 ou 13 (ou toute machine Debian), avec systemd.
# À lancer en root DANS le conteneur, depuis le dossier du dépôt :  bash install/lxc.sh
# Mise à jour : git pull, puis relancer le même script (les données et le fichier .env sont conservés).
set -euo pipefail
NODE_VERSION="${NODE_VERSION:-24.22.1}"
APP_DIR=/opt/sillage
DATA_DIR=/var/lib/sillage
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"

[ "$(id -u)" = 0 ] || { echo "Lancer en root."; exit 1; }
apt-get update -qq
apt-get install -y -qq ca-certificates curl xz-utils rsync openssl >/dev/null

# Node.js officiel, empreinte vérifiée
arch=$(dpkg --print-architecture); case "$arch" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo "Architecture non prise en charge : $arch"; exit 1 ;; esac
if [ ! -x "/opt/node/bin/node" ] || [ "$(/opt/node/bin/node -v)" != "v$NODE_VERSION" ]; then
  tmp=$(mktemp -d); cd "$tmp"
  file="node-v$NODE_VERSION-linux-$arch.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/$file"
  curl -fsSLO "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"
  grep " $file\$" SHASUMS256.txt | sha256sum -c -
  rm -rf /opt/node && mkdir -p /opt/node && tar xJf "$file" -C /opt/node --strip-components=1
  cd / && rm -rf "$tmp"
fi
export PATH=/opt/node/bin:$PATH

id sillage >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin sillage
install -d -o sillage -g sillage -m 700 "$DATA_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude dist --exclude data --exclude .env --exclude .git "$SOURCE/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
npm test
npm prune --omit=dev

if [ ! -f "$APP_DIR/.env" ]; then
  ip=$(hostname -I | awk '{print $1}')
  sed -e "s|^APP_ORIGIN=.*|APP_ORIGIN=http://$ip:3000|" \
      -e "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR|" \
      -e "s|^SSH_KEY_PATH=.*|SSH_KEY_PATH=$DATA_DIR/id_ed25519|" \
      -e "s|^BOOTSTRAP_TOKEN=.*|BOOTSTRAP_TOKEN=$(openssl rand -hex 24)|" .env.example > .env
  created=1
fi
chown root:sillage .env && chmod 640 .env

cat > /etc/systemd/system/sillage.service <<UNIT
[Unit]
Description=Sillage - Samba Manager
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=sillage
Group=sillage
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/opt/node/bin/node --env-file=$APP_DIR/.env server/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
UMask=0077
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now sillage
systemctl restart sillage
sleep 2; systemctl --no-pager --lines=3 status sillage || true
origin=$(grep '^APP_ORIGIN=' .env | cut -d= -f2-)
echo
echo "Sillage tourne : $origin"
if [ "${created:-0}" = 1 ]; then
  echo "Code d'installation (premier compte) : $(grep '^BOOTSTRAP_TOKEN=' .env | cut -d= -f2-)"
  echo "Réglages (adresse publique, OIDC) : $APP_DIR/.env, puis : systemctl restart sillage"
fi

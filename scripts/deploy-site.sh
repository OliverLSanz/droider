#!/bin/zsh
# Publishes site/ (landing page and guide) to https://oliverlsanz.com/droider/.
# The VPS's Nginx serves ~/vps/html/droider (SSH host, port and key in ~/.ssh/config).
set -euo pipefail
PROJECT_DIR="${0:A:h:h}"
HOST="${DROIDER_SITE_HOST:-oliverlsanz.com}"
REMOTE_DIR="${DROIDER_SITE_DIR:-vps/html/droider}"
URL="${DROIDER_SITE_URL:-https://oliverlsanz.com/droider/}"

ssh "$HOST" "mkdir -p '$REMOTE_DIR'"
# macOS ships openrsync, without --chmod: set permissions remotely instead.
rsync -rlz --delete --exclude .DS_Store "$PROJECT_DIR/site/" "$HOST:$REMOTE_DIR/"
ssh "$HOST" "find '$REMOTE_DIR' -type d -exec chmod 755 {} + && find '$REMOTE_DIR' -type f -exec chmod 644 {} +"
for page in "" docs/ assets/style.css assets/site.js assets/screens/editor.webp assets/video/tour.mp4; do
    curl --fail --silent --show-error --output /dev/null "$URL$page"
done
print "Published: $URL"

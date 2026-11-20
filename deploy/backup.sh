#!/usr/bin/env bash
# Nightly logical backup of the database, kept for 14 days. Run by deals-backup.timer.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=${BACKUP_DIR:-$HOME/backups/deals}
mkdir -p "$dir"
file="$dir/deals-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U deals -d deals --no-owner | gzip >"$file.tmp"
mv "$file.tmp" "$file"
find "$dir" -name 'deals-*.sql.gz' -mtime +14 -delete
echo "Backup written to $file"

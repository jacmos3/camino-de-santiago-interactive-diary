#!/usr/bin/env bash
set -euo pipefail

# Build a deploy-ready copy of the site while pruning non-runtime data files.
# Usage:
#   scripts/prune-deploy.sh [output_dir]
#
# Example:
#   scripts/prune-deploy.sh deploy-runtime-pruned

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR="${1:-${ROOT_DIR}/deploy-runtime-pruned}"

echo "[INFO] Source: ${ROOT_DIR}"
echo "[INFO] Output: ${OUTPUT_DIR}"

mkdir -p "${OUTPUT_DIR}"

# Copy whole project (excluding git metadata). We prune inside data/ afterward.
rsync -a --delete \
  --exclude ".git/" \
  --exclude ".DS_Store" \
  "${ROOT_DIR}/" "${OUTPUT_DIR}/"

DATA_DIR="${OUTPUT_DIR}/data"
TRACK_DAY_DIR="${DATA_DIR}/tracks/day"

if [[ ! -d "${DATA_DIR}" ]]; then
  echo "[ERROR] Missing data dir in output: ${DATA_DIR}" >&2
  exit 1
fi

# Keep only runtime data files at data root.
declare -a KEEP_DATA_ROOT=(
  "entries.it.json"
  "entries.en.json"
  "entries.es.json"
  "entries.fr.json"
  "comments.json"
  "ui_flags.json"
  "track_points.json"
  "tracks"
)

for entry_path in "${DATA_DIR}"/*; do
  entry_name="$(basename "${entry_path}")"
  keep="0"
  for allowed in "${KEEP_DATA_ROOT[@]}"; do
    if [[ "${entry_name}" == "${allowed}" ]]; then
      keep="1"
      break
    fi
  done
  if [[ "${keep}" == "0" ]]; then
    rm -rf "${entry_path}"
  fi
done

# Ensure ui_flags runtime file exists.
if [[ ! -f "${DATA_DIR}/ui_flags.json" ]]; then
  cat > "${DATA_DIR}/ui_flags.json" <<'JSON'
{
  "show_footer_template_cta": true
}
JSON
fi

# Keep only tracks/index.json and day/*.json (except known exclusion).
if [[ -d "${DATA_DIR}/tracks" ]]; then
  for track_entry in "${DATA_DIR}/tracks"/*; do
    name="$(basename "${track_entry}")"
    if [[ "${name}" != "index.json" && "${name}" != "day" ]]; then
      rm -rf "${track_entry}"
    fi
  done
fi

if [[ -d "${TRACK_DAY_DIR}" ]]; then
  find "${TRACK_DAY_DIR}" -type f ! -name "*.json" -delete
  rm -f "${TRACK_DAY_DIR}/2019-12-02.json"
fi

# Clean leftover DS_Store files everywhere in output.
find "${OUTPUT_DIR}" -name ".DS_Store" -type f -delete || true

echo "[DONE] Pruned deploy created at: ${OUTPUT_DIR}"
echo "[INFO] Runtime data kept:"
echo "  - data/entries.{it,en,es,fr}.json"
echo "  - data/comments.json"
echo "  - data/ui_flags.json"
echo "  - data/track_points.json"
echo "  - data/tracks/index.json"
echo "  - data/tracks/day/*.json (excluding 2019-12-02.json)"

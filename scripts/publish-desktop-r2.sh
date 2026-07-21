#!/usr/bin/env bash
# Publish desktop release artifacts from dist/ to Cloudflare R2.
# Mirrors the historical Roder CLI R2 publish pattern (pre-0c20c12d).
#
# Required env:
#   R2_ACCOUNT_ID, R2_BUCKET, R2_PUBLIC_BASE_URL
#   GITHUB_SHA
#   Either:
#     R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY  (preferred; R2 S3 API token)
#     or CLOUDFLARE_API_TOKEN (legacy account-token derive path)
# Optional env:
#   DIST_DIR (default: dist)
#   GITHUB_REF / GITHUB_REF_NAME (tag pushes publish versioned+latest; else desktop/dev)
#   RODER_PUBLISH_VERIFY_ATTEMPTS (default: 10)
#   RODER_PUBLISH_VERIFY_DELAY_SECONDS (default: 5)
set -euo pipefail

dist_dir="${DIST_DIR:-dist}"
r2_account_id="${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
r2_bucket="${R2_BUCKET:?R2_BUCKET is required}"
r2_public_base_url="${R2_PUBLIC_BASE_URL:?R2_PUBLIC_BASE_URL is required}"
r2_public_base_url="${r2_public_base_url%/}"
commit="${GITHUB_SHA:?GITHUB_SHA is required}"
verify_attempts="${RODER_PUBLISH_VERIFY_ATTEMPTS:-10}"
verify_delay_seconds="${RODER_PUBLISH_VERIFY_DELAY_SECONDS:-5}"

if [[ ! -d "$dist_dir" ]]; then
  echo "publish-r2: dist directory not found: $dist_dir" >&2
  exit 1
fi

if [[ -z "${R2_ACCESS_KEY_ID:-}" || -z "${R2_SECRET_ACCESS_KEY:-}" ]]; then
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "publish-r2: set R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY (preferred) or CLOUDFLARE_API_TOKEN" >&2
    exit 1
  fi
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "publish-r2: installing awscli via pip"
  python3 -m pip install --user awscli
  export PATH="${HOME}/.local/bin:${PATH}"
  if command -v python3 >/dev/null 2>&1; then
    user_base="$(python3 -m site --user-base 2>/dev/null || true)"
    if [[ -n "${user_base:-}" ]]; then
      export PATH="${user_base}/bin:${user_base}/Scripts:${PATH}"
    fi
  fi
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "publish-r2: aws CLI is required for R2 upload" >&2
  exit 1
fi

content_type_for() {
  local name="$1"
  case "$name" in
    manifest.json|updates.json) echo "application/json; charset=utf-8" ;;
    appcast.xml) echo "application/xml; charset=utf-8" ;;
    SHA256SUMS|SHA256SUMS.txt|*.txt|RELEASES) echo "text/plain; charset=utf-8" ;;
    *.dmg|*.zip|*.exe|*.nupkg) echo "application/octet-stream" ;;
    *) echo "application/octet-stream" ;;
  esac
}

# Collect regular files under dist/ (non-recursive; matches current release layouts).
# Avoid mapfile/readarray for macOS /bin/bash 3.2 compatibility.
artifact_paths=()
while IFS= read -r path; do
  [[ -n "$path" ]] || continue
  artifact_paths+=("$path")
done < <(find "$dist_dir" -maxdepth 1 -type f ! -name 'manifest.json' | LC_ALL=C sort)

if [[ "${#artifact_paths[@]}" -eq 0 ]]; then
  echo "publish-r2: no artifacts found in $dist_dir" >&2
  exit 1
fi

if [[ "${GITHUB_REF:-}" == refs/tags/* ]]; then
  tag="${GITHUB_REF_NAME:?GITHUB_REF_NAME is required for tag publishes}"
  # Tag channels: immutable versioned path + mutable latest alias.
  channels=("desktop/${tag}" "desktop/latest")
  channel_versions=("$tag" "latest")
  channel_tags=("$tag" "$tag")
  channel_cache=(
    "public, max-age=31536000, immutable"
    "public, max-age=300"
  )
else
  tag=""
  channels=("desktop/dev")
  channel_versions=("dev")
  channel_tags=("")
  channel_cache=("public, max-age=300")
fi

if [[ -n "${R2_ACCESS_KEY_ID:-}" && -n "${R2_SECRET_ACCESS_KEY:-}" ]]; then
  echo "publish-r2: using R2 S3 API credentials"
  access_key_id="$R2_ACCESS_KEY_ID"
  secret_access_key="$R2_SECRET_ACCESS_KEY"
else
  echo "publish-r2: deriving R2 credentials from Cloudflare API token (legacy)"
  verify_json="$(curl -fsSL \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${r2_account_id}/tokens/verify")"

  # Prefer python over jq so Windows bash runners do not need an extra binary.
  cred_line="$(
    VERIFY_JSON="$verify_json" python3 - <<'PY'
import json, os
payload = json.loads(os.environ["VERIFY_JSON"])
result = payload.get("result") or {}
print((result.get("id") or "") + " " + (result.get("status") or ""))
PY
  )"
  access_key_id="${cred_line%% *}"
  token_status="${cred_line#* }"

  if [[ -z "$access_key_id" || "$token_status" != "active" ]]; then
    echo "publish-r2: Cloudflare account token verification failed" >&2
    exit 1
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    secret_access_key="$(printf '%s' "$CLOUDFLARE_API_TOKEN" | sha256sum | awk '{print $1}')"
  else
    secret_access_key="$(printf '%s' "$CLOUDFLARE_API_TOKEN" | shasum -a 256 | awk '{print $1}')"
  fi
fi

endpoint="https://${r2_account_id}.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="$access_key_id"
export AWS_SECRET_ACCESS_KEY="$secret_access_key"
export AWS_DEFAULT_REGION=auto

uploaded_urls=()

upload_object() {
  local local_path="$1"
  local key="$2"
  local cache_control="$3"
  local name content_type
  name="$(basename "$local_path")"
  content_type="$(content_type_for "$name")"
  aws s3 cp "$local_path" "s3://${r2_bucket}/${key}" \
    --endpoint-url "$endpoint" \
    --content-type "$content_type" \
    --cache-control "$cache_control" \
    --no-progress
  uploaded_urls+=("${r2_public_base_url}/${key}")
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# Bash 3.2-safe indexed loop.
channel_count="${#channels[@]}"
i=0
while [[ "$i" -lt "$channel_count" ]]; do
  channel="${channels[$i]}"
  version="${channel_versions[$i]}"
  channel_tag="${channel_tags[$i]}"
  cache_control="${channel_cache[$i]}"
  manifest_path="${tmp_dir}/manifest-${i}.json"

  echo "publish-r2: writing manifest for ${channel}"
  # Merge with any existing channel manifest so macOS + Windows CI can
  # publish independently without clobbering the other platform's entries.
  existing_manifest_path="${tmp_dir}/existing-manifest-${i}.json"
  if curl -fsSL "${r2_public_base_url}/${channel}/manifest.json" \
      -o "$existing_manifest_path" 2>/dev/null; then
    echo "publish-r2: merging with existing ${channel}/manifest.json"
  else
    rm -f "$existing_manifest_path"
  fi

  OUT_PATH="$manifest_path" \
  EXISTING_MANIFEST_PATH="$existing_manifest_path" \
  DIST_DIR="$dist_dir" \
  CHANNEL_PREFIX="$channel" \
  VERSION="$version" \
  TAG="$channel_tag" \
  COMMIT="$commit" \
  R2_PUBLIC_BASE_URL="$r2_public_base_url" \
  ARTIFACT_PATHS="$(printf '%s\n' "${artifact_paths[@]}")" \
    python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

channel_prefix = os.environ["CHANNEL_PREFIX"].strip("/")
version = os.environ["VERSION"]
tag = os.environ.get("TAG") or None
if tag == "":
    tag = None
commit = os.environ["COMMIT"]
base = os.environ["R2_PUBLIC_BASE_URL"].rstrip("/")
paths = [Path(line) for line in os.environ["ARTIFACT_PATHS"].splitlines() if line.strip()]

by_name = {}
existing_path = Path(os.environ.get("EXISTING_MANIFEST_PATH") or "")
if existing_path.is_file():
    try:
        existing = json.loads(existing_path.read_text())
        for artifact in existing.get("artifacts") or []:
            name = artifact.get("name")
            if name:
                by_name[name] = artifact
    except Exception:
        pass

for path in paths:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    name = path.name
    by_name[name] = {
        "name": name,
        "url": f"{base}/{channel_prefix}/{name}",
        "sha256": digest,
        "bytes": path.stat().st_size,
    }

manifest = {
    "version": version,
    "tag": tag,
    "commit": commit,
    "artifacts": [by_name[name] for name in sorted(by_name)],
}
Path(os.environ["OUT_PATH"]).write_text(json.dumps(manifest, indent=2) + "\n")
PY

  for path in "${artifact_paths[@]}"; do
    name="$(basename "$path")"
    # Feeds are regenerated per-channel below so enclosure URLs match the channel.
    if [[ "$name" == "updates.json" || "$name" == "appcast.xml" ]]; then
      continue
    fi
    echo "publish-r2: upload s3://${r2_bucket}/${channel}/${name}"
    upload_object "$path" "${channel}/${name}" "$cache_control"
  done

  # macOS CI: Sparkle / Squirrel.Mac feeds live on R2 next to the zip so releases
  # can refresh https://dl.roder.sh/desktop/latest/updates.json from CI.
  if [[ -f "${dist_dir}/Roder-macos-arm64.zip" ]]; then
    feed_version="$version"
    if [[ "$feed_version" == "latest" && -n "$channel_tag" ]]; then
      feed_version="${channel_tag#v}"
    elif [[ "$feed_version" == "dev" ]]; then
      feed_version="$(node -p "require('./package.json').version" 2>/dev/null || true)"
      feed_version="${feed_version#v}"
    fi
    echo "publish-r2: generating update feeds for ${channel}"
    DIST_DIR="$dist_dir" \
    R2_PUBLIC_BASE_URL="$r2_public_base_url" \
    CHANNEL_PREFIX="$channel" \
    VERSION="$feed_version" \
    TAG="$channel_tag" \
    PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
      node scripts/generate-desktop-update-feeds.mjs
    for feed_name in updates.json appcast.xml; do
      if [[ -f "${dist_dir}/${feed_name}" ]]; then
        echo "publish-r2: upload s3://${r2_bucket}/${channel}/${feed_name}"
        upload_object "${dist_dir}/${feed_name}" "${channel}/${feed_name}" "$cache_control"
        # Keep feeds listed in the channel manifest for the site / tooling.
        MANIFEST_PATH="$manifest_path" \
        FEED_PATH="${dist_dir}/${feed_name}" \
        FEED_URL="${r2_public_base_url}/${channel}/${feed_name}" \
          python3 - <<'PY'
import hashlib, json, os
from pathlib import Path
manifest_path = Path(os.environ["MANIFEST_PATH"])
feed_path = Path(os.environ["FEED_PATH"])
feed_url = os.environ["FEED_URL"]
manifest = json.loads(manifest_path.read_text())
artifacts = [a for a in manifest.get("artifacts") or [] if a.get("name") != feed_path.name]
digest = hashlib.sha256(feed_path.read_bytes()).hexdigest()
artifacts.append({
    "name": feed_path.name,
    "url": feed_url,
    "sha256": digest,
    "bytes": feed_path.stat().st_size,
})
manifest["artifacts"] = sorted(artifacts, key=lambda a: a["name"])
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
PY
      fi
    done
  fi

  echo "publish-r2: upload s3://${r2_bucket}/${channel}/manifest.json"
  upload_object "$manifest_path" "${channel}/manifest.json" "$cache_control"

  i=$((i + 1))
done

verify_url() {
  local url="$1"
  local attempt
  attempt=1
  while [[ "$attempt" -le "$verify_attempts" ]]; do
    if curl -fsSIL "$url" >/dev/null 2>&1; then
      echo "publish-r2: verified $url"
      return 0
    fi
    if [[ "$attempt" -ne "$verify_attempts" ]]; then
      echo "publish-r2: verify attempt ${attempt}/${verify_attempts} failed for $url; retrying in ${verify_delay_seconds}s" >&2
      sleep "$verify_delay_seconds"
    fi
    attempt=$((attempt + 1))
  done
  echo "publish-r2: failed to verify $url after ${verify_attempts} attempts" >&2
  return 1
}

echo "publish-r2: verifying ${#uploaded_urls[@]} public URL(s)"
for url in "${uploaded_urls[@]}"; do
  verify_url "$url"
done

echo "publish-r2: done"
for channel in "${channels[@]}"; do
  echo "publish-r2: manifest ${r2_public_base_url}/${channel}/manifest.json"
done

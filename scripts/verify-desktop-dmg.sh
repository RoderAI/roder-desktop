#!/usr/bin/env bash
set -euo pipefail

dmg="${1:?Usage: verify-desktop-dmg.sh <path-to-dmg>}"
mount_point="$(mktemp -d "${TMPDIR:-/tmp}/roder-dmg-check.XXXXXX")"
attached=0

cleanup() {
  if [[ "${attached}" == 1 ]]; then
    hdiutil detach "${mount_point}" -quiet || return
  fi
  rmdir "${mount_point}"
}
trap cleanup EXIT

hdiutil attach "${dmg}" -readonly -nobrowse -mountpoint "${mount_point}" -quiet
attached=1

if [[ ! -d "${mount_point}/Roder.app" ]]; then
  echo "DMG is missing Roder.app" >&2
  exit 1
fi
if [[ ! -L "${mount_point}/Applications" || "$(readlink "${mount_point}/Applications")" != "/Applications" ]]; then
  echo "DMG is missing the drag-to-install /Applications shortcut" >&2
  exit 1
fi
if [[ ! -f "${mount_point}/.DS_Store" ]]; then
  echo "DMG is missing its Finder window layout" >&2
  exit 1
fi

echo "DMG verified: Roder.app, Applications shortcut, and Finder layout"

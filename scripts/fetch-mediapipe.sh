#!/usr/bin/env sh
# Fetch the MediaPipe hand model and wasm into web/public/mediapipe.
# They are 21 MB of binaries and are not versioned; see
# web/public/mediapipe/CREDITS.md for sources, licence and hashes.
# Run once after clone: sh scripts/fetch-mediapipe.sh
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)/web/public/mediapipe"
mkdir -p "$DIR/wasm"

MODEL_URL="https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
MODEL_SHA="fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
WASM_SHA="0e101a010e262ef8e78f22e3c95b60a9705fd06962753c9acd6356d9fb56b7bd"
WASM_PKG="@mediapipe/tasks-vision@1.1.1"

sha() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1 || sha256sum "$1" | cut -d' ' -f1; }

verify() {
  actual="$(sha "$1")"
  if [ "$actual" != "$2" ]; then
    echo "hash mismatch for $1" >&2
    echo "  expected $2" >&2
    echo "  got      $actual" >&2
    rm -f "$1"
    exit 1
  fi
  echo "ok  $(basename "$1")"
}

if [ ! -f "$DIR/hand_landmarker.task" ]; then
  echo "fetching hand_landmarker.task (7.5 MB)"
  curl -fsSL "$MODEL_URL" -o "$DIR/hand_landmarker.task"
fi
verify "$DIR/hand_landmarker.task" "$MODEL_SHA"

if [ ! -f "$DIR/wasm/vision_wasm_internal.wasm" ]; then
  echo "extracting wasm from $WASM_PKG (13 MB)"
  TMP="$(mktemp -d)"
  ( cd "$TMP" && npm pack "$WASM_PKG" --silent >/dev/null && tar -xzf ./*.tgz )
  cp "$TMP/package/wasm/vision_wasm_internal.wasm" "$DIR/wasm/"
  rm -rf "$TMP"
fi
verify "$DIR/wasm/vision_wasm_internal.wasm" "$WASM_SHA"

echo "mediapipe assets ready in web/public/mediapipe"

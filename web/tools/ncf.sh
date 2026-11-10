#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode="copy"
if [ "${1:-}" = "--check" ]; then
  mode="check"
  shift
fi
src="${1:-../../ncf}"
if [ ! -f "$src/web/ncf-panel.css" ]; then
  echo "usage: tools/ncf.sh [--check] path/to/ncf checkout" >&2
  exit 2
fi
ref="$(git -C "$src" rev-parse HEAD)"
out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
mkdir -p "$out/fonts" "$out/brand"
cp "$src/web/ncf.css" "$src/web/ncf-tokens.css" "$src/web/ncf-panel.css" "$out/"
cp "$src/web/fonts/"*.woff2 "$src/web/fonts/"LICENSE-* "$out/fonts/"
cp "$src/brand/logo.svg" "$src/brand/logo-dark.svg" "$src/brand/app-icon.svg" "$out/brand/"
if [ "$mode" = "check" ]; then
  if [ "$(cat ncf.ref)" != "$ref" ]; then
    echo "ncf.ref says $(cat ncf.ref) but the checkout is $ref" >&2
    exit 1
  fi
  diff -r "$out" src/ncf >/dev/null || { echo "src/ncf differs from NCF $ref. Run npm run ncf." >&2; diff -rq "$out" src/ncf >&2; exit 1; }
  echo "src/ncf matches NCF $ref"
  exit 0
fi
rm -rf src/ncf
mkdir -p src
cp -r "$out" src/ncf
echo "$ref" > ncf.ref
echo "src/ncf is NCF $ref"

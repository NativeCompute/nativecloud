#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

pattern='eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.|sbp_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}|AGE-SECRET-KEY-|-----BEGIN [A-Z ]*PRIVATE KEY-----'
if found="$(git ls-files -z -- . ":!tools/no-secrets.sh" | xargs -0 grep -nIE "$pattern" -- 2>/dev/null)"; then
  echo "Possible secrets:" >&2
  echo "$found" | cut -c1-120 >&2
  exit 1
fi
echo "No secrets."

#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
bad=0
while IFS= read -r f; do
  case "$f" in
    *.sql) hits=$(grep -nE '(^|[^-:])--' "$f" | grep -vE "'[^']*--" | grep -vE '^[0-9]+:\s*-- [A-Za-z0-9 _:()./-]+ here(---)?\s*$') ;;
    *.ts|*.mjs) hits=$(grep -nE '(^|[^:"])//' "$f" | grep -vE '//[^"]*"' | grep -vE 'https?://' | grep -vE '^[0-9]+:\s*// [A-Za-z0-9 _:()./-]+ here(---)?\s*$') ;;
    *.html) hits=$(grep -nE '<!--' "$f") ;;
    *.sh) hits=$(grep -nE '^\s*#' "$f" | grep -vE '^1:#!') ;;
    *) hits="" ;;
  esac
  if [ -n "$hits" ]; then
    echo "$f"
    echo "$hits" | sed 's/^/  /'
    bad=1
  fi
done < <(git ls-files --cached --others --exclude-standard -- '*.sql' '*.ts' '*.mjs' '*.html' '*.sh')
if [ "$bad" = 1 ]; then
  echo "Comments found. Use a lazy marker such as '-- thing here' or move the explanation to docs/."
  exit 1
fi
echo "No comments."

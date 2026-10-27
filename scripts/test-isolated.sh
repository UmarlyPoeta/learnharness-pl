#!/usr/bin/env bash
# Run the test suite against a throwaway data dir and auth file, so a test
# can never write into the real data/ (sessions, graph) or read the real
# repo-root auth.json (keys). Extra args replace the default file globs.
set -euo pipefail
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export NODE_ENV=test LH_DATA_DIR="$TMP/data" LH_AUTH_FILE="$TMP/auth.json"
if [ $# -eq 0 ]; then set -- tests/*.test.ts tests/*.test.tsx; fi
npx tsx --test "$@"

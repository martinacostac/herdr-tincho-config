#!/bin/sh
# Build the stand-in by hand: sh suspend/build.sh [output]   (default: ./herdr-standin)
# Bun's small ahead-of-time compile when this Bun has it, otherwise the
# standard compile. Check the footprint of a running copy (10 MB or less):
#   macOS: footprint <pid>      Linux: grep VmRSS /proc/<pid>/status
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-herdr-standin}
if bun compile --help >/dev/null 2>&1; then
  bun compile --trim-locales en --no-compile-function-source --outfile "$out" "$here/main.ts"
else
  bun build --compile --minify --outfile "$out" "$here/main.ts"
fi

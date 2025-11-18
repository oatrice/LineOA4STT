#!/usr/bin/env sh
set -e

if [ "$PROCESS" = "worker" ]; then
  echo "🚀 Starting worker..."
  exec bun worker.ts
else
  echo "🌐 Starting web server..."
  exec bun server.ts
fi

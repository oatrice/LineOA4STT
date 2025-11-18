#!/usr/bin/env sh
set -e

start_server() {
  echo "🌐 Starting web server..."
  bun server.ts &
  SERVER_PID=$!
}

start_worker() {
  echo "🚀 Starting worker..."
  bun worker.ts &
  WORKER_PID=$!
}

shutdown() {
  echo "🛑 Shutting down processes..."
  [ -n "$SERVER_PID" ] && kill -TERM "$SERVER_PID" 2>/dev/null || true
  [ -n "$WORKER_PID" ] && kill -TERM "$WORKER_PID" 2>/dev/null || true
}

trap 'shutdown; exit 0' INT TERM

if [ "$PROCESS" = "worker" ]; then
  start_worker
  wait "$WORKER_PID"
  exit $?
elif [ "$PROCESS" = "both" ]; then
  # Start both server and worker in background in the same container
  start_server
  start_worker

  # Monitor: if either process exits, stop the other and exit
  while true; do
    if [ -n "$SERVER_PID" ] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "server exited; stopping worker"
      shutdown
      break
    fi
    if [ -n "$WORKER_PID" ] && ! kill -0 "$WORKER_PID" 2>/dev/null; then
      echo "worker exited; stopping server4"
      shutdown
      break
    fi
    sleep 1
  done

  # wait a moment for processes to terminate
  wait
  exit 0
else
  start_server
  wait "$SERVER_PID"
  exit $?
fi

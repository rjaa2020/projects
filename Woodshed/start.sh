#!/bin/bash
set -e

# Start the Python engine/API in the background (internal only, 127.0.0.1:8000)
python3 -m woodshed.api &
API_PID=$!

# Wait for the API to come up before starting the web GUI
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8000/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Start the Node web GUI in the foreground (this is what the platform's $PORT points to)
node web/server.js &
WEB_PID=$!

# If either process dies, exit so the platform restarts the container
wait -n "$API_PID" "$WEB_PID"

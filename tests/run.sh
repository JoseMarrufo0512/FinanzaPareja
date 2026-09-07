#!/usr/bin/env bash
# Full local test cycle: fresh database, fresh server, both suites.
set -e
cd "$(dirname "$0")/.."
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 2
./tests/reset-db.sh >/dev/null 2>&1
nohup npm run dev > /tmp/nfpg/dev.log 2>&1 &
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health || true)
  [ "$code" = "200" ] && break
  sleep 2
done
echo "server: $code"
node tests/parser.test.mjs
node tests/api.test.mjs

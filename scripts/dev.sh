#!/usr/bin/env bash
# Start both servers cleanly.
#
# Guards against the one failure that keeps recurring: running `next build`
# while `next dev` is live makes both write to apps/web/.next, and the dev
# server then serves half-production chunks and 500s with MODULE_NOT_FOUND.
# Never run build and dev at the same time — this script clears the wreckage
# if it already happened.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "· freeing ports 3000 and 8787"
lsof -ti:3000 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti:8787 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# A production build leaves BUILD_ID behind; dev output does not.
if [ -f apps/web/.next/BUILD_ID ]; then
  echo "· clearing production build output from .next"
  rm -rf apps/web/.next
fi

[ -f .env ] || { echo "! no .env — copy .env.example and add your keys"; exit 1; }
set -a && . ./.env && set +a

echo "· starting voice server on :8787"
pnpm --filter @vaani/voice-server start > /tmp/vaani-server.log 2>&1 &
VOICE=$!

echo "· starting console on :3000"
pnpm --filter @vaani/web dev > /tmp/vaani-web.log 2>&1 &
WEB=$!

trap 'kill $VOICE $WEB 2>/dev/null' INT TERM

for i in $(seq 1 40); do
  ok_v=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://localhost:8787/health 2>/dev/null || echo 000)
  ok_w=$(curl -s -m 2 -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null || echo 000)
  [ "$ok_v" = "200" ] && [ "$ok_w" = "200" ] && break
  sleep 1
done

echo
echo "  ▚ Vaani is up"
echo "    console      http://localhost:3000"
echo "    voice server ws://localhost:8787/session"
echo "    logs         /tmp/vaani-web.log  /tmp/vaani-server.log"
echo
echo "  Ctrl-C to stop both."
wait

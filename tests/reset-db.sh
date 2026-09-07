#!/usr/bin/env bash
# Wipe the local dev database so tests start from zero.
set -e
psql "${DEV_DATABASE_URL:-postgres://dev@127.0.0.1:55432/nf_dev}" -q \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
echo "dev database reset"

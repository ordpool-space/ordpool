#!/usr/bin/env bash
# Build OUR ordpool fork backend image for the E2E regtest — the same
# backend-staging + buildx path .github/workflows/docker.yml uses.
#
# The fork Dockerfile (docker/backend/Dockerfile) can't build from a plain
# compose build-context: it does `COPY /build/GeoIP` and its main context must
# already contain the Dockerfile + the GeoLite2 dbs. We stage those the way
# docker/init.sh's backend half does (copy docker/backend/* into backend/,
# fetch the GeoIP dbs). We deliberately DON'T run the full init.sh: its
# frontend/nginx `sed -i"" -e` prep is a GNU-ism that leaves *.conf-e backup
# cruft on macOS/BSD and isn't needed to build the backend. All staged outputs
# are gitignored (backend/.gitignore).
#
# The fork backend is NOT the upstream mempool/backend image: it adds the
# /api/* esplora proxy, /content + /preview inscription SSR, and the
# _ordpoolFlags. Produces ordpool-e2e-backend:local, which
# docker-compose.ordpool-backend.yml references.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

cd "$REPO"

# Stage the fork Dockerfile + support files into backend/ (gitignored).
cp -R docker/backend/. backend/

# GeoIP is prod IP-geolocation only; regtest doesn't use it. Fetch the real
# dbs; if offline/blocked, fall back to empty files so the Dockerfile's
# `COPY /build/GeoIP` step still succeeds.
mkdir -p backend/GeoIP
GEOIP=https://raw.githubusercontent.com/mempool/geoip-data/master
[ -s backend/GeoIP/GeoLite2-City.mmdb ] || curl -fsSL -o backend/GeoIP/GeoLite2-City.mmdb "$GEOIP/GeoLite2-City.mmdb" || : > backend/GeoIP/GeoLite2-City.mmdb
[ -s backend/GeoIP/GeoLite2-ASN.mmdb ]  || curl -fsSL -o backend/GeoIP/GeoLite2-ASN.mmdb  "$GEOIP/GeoLite2-ASN.mmdb"  || : > backend/GeoIP/GeoLite2-ASN.mmdb

# Native-arch build (no --platform) so it runs without emulation locally.
# Same named build-contexts as docker.yml: rust-gbt native module + backend.
docker buildx build \
  --tag ordpool-e2e-backend:local \
  --build-context rustgbt=./rust \
  --build-context backend=./backend \
  --build-arg commitHash=local-e2e \
  --load \
  ./backend/

# syntax=docker/dockerfile:1.7
#
# FM Coach — production Docker image for Fly.io
#
# Architecture: Next.js 16 + Python 3.12 shell-out scripts in the same
# container. The Next server actions spawn `.venv/bin/python` for AI calls
# (assess, rework, letter generation, intake insights). All ~30 Python
# shims share one venv built in Stage 2.
#
# Stage 1 — Node deps + Next build
# Stage 2 — Python venv with Anthropic SDK + pyyaml + python-dotenv + html2text
# Stage 3 — Minimal runtime (node + python3 + venv + built Next app)
#
# Runtime paths preserved from dev:
#   /app/fm-database-web              ← Next server cwd
#   /app/fm-database/.venv/bin/python ← shell-out target
#   /app/fm-database/data/            ← catalogue (read-only)
#   /data/fm-plans/                   ← Fly volume mount, client PHI
#   /data/fm-resources/               ← Fly volume mount, shareable resources
#
# Local build for smoke-test:
#   docker build -t fm-coach . && docker run --rm -p 3002:3002 \
#     -e ANTHROPIC_API_KEY=... -e COACH_AUTH_PASSWORD=test fm-coach


# ─── Stage 1: Next.js build ─────────────────────────────────────────────
FROM node:22-bookworm-slim AS web-build

WORKDIR /app/fm-database-web
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# Install deps first (better layer caching)
COPY fm-database-web/package.json fm-database-web/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund --prefer-offline

# Copy the rest of the Next app
COPY fm-database-web/ ./

# Catalogue YAML is read by server components at build + runtime via
# loader.ts. Bring it under /app/ so the relative path
# `path.resolve(process.cwd(), "../fm-database")` from server actions
# matches the dev layout.
COPY fm-database/data /app/fm-database/data

# Build the Next.js standalone-ish output. We don't actually use
# `output: 'standalone'` because we need node_modules at runtime for the
# server actions that import third-party SDKs (js-yaml, nodemailer).
RUN npm run build


# ─── Stage 1b: Mutagen agent (linux_amd64) ─────────────────────────────
#
# Mutagen's auto-install needs scp/tar/openssh-client — none of which
# exist in our slim runtime. Without the agent pre-placed, the first
# `mutagen sync create` against this container falls back to streaming
# the binary over `cat | ssh ... 'cat > file'`, which works one-off but
# leaves the agent on the container's ephemeral fs — every deploy /
# crash / machine restart wipes it and silently breaks sync.
#
# This stage downloads the agent bundle from GitHub releases (signed by
# Mutagen's official build pipeline) and stages the linux_amd64 binary
# at /agent/mutagen-agent. Stage 3 then copies it to BOTH places the
# Mutagen client looks for an agent when SSH'ing in:
#   /app/fm-database-web/.mutagen/agents/<ver>/mutagen-agent (relative to PWD)
#   /root/.mutagen/agents/<ver>/mutagen-agent                (relative to $HOME)
#
# To bump Mutagen versions in the future: change MUTAGEN_VERSION below
# AND also update your local Mutagen on the Mac (versions must match
# exactly between client + agent — Mutagen will refuse to connect
# otherwise).
FROM debian:bookworm-slim AS mutagen-agent-fetch
ARG MUTAGEN_VERSION=0.18.1
ARG MUTAGEN_PLATFORM=linux_amd64
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN mkdir -p /agent && cd /agent && \
    curl -fsSL \
      "https://github.com/mutagen-io/mutagen/releases/download/v${MUTAGEN_VERSION}/mutagen_${MUTAGEN_PLATFORM}_v${MUTAGEN_VERSION}.tar.gz" \
      -o mutagen.tar.gz && \
    tar -xzf mutagen.tar.gz && \
    # mutagen-agents.tar.gz contains files NAMED after platforms (not
    # subdirs) — i.e. `linux_amd64` IS the agent binary, not a directory.
    # Extract just the one we want and rename it to mutagen-agent for the
    # stage-3 COPY to pick up.
    tar -xzf mutagen-agents.tar.gz "${MUTAGEN_PLATFORM}" && \
    mv "${MUTAGEN_PLATFORM}" mutagen-agent && \
    chmod +x mutagen-agent && \
    ls -lh mutagen-agent


# ─── Stage 2: Python venv ──────────────────────────────────────────────
#
# IMPORTANT: build the venv using the SAME Python the runtime stage has.
# The runtime is `node:22-bookworm-slim` + `apt install python3` which
# gives Debian Bookworm's system Python 3.11 at /usr/bin/python3. If
# stage 2 uses `python:3.12-slim-bookworm` (Python 3.12 at
# /usr/local/bin/python3), the venv's internal symlinks point at the
# 3.12 binary — which doesn't exist in the runtime stage. Every shell-out
# from Next.js to a Python shim then fails with "No such file or directory"
# (which renders as "This link can't be opened" on /intake/[token]).
#
# Fix: use the same `node:22-bookworm-slim` base + apt-install Python 3.11
# + python3-venv. Now the venv's interpreter symlinks resolve to a binary
# that IS present in the runtime image.
FROM node:22-bookworm-slim AS python-build

WORKDIR /app/fm-database
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Debian's system Python + venv module + build deps for any wheels that
# need compilation (lxml, cffi, etc.).
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip build-essential && \
    rm -rf /var/lib/apt/lists/*

COPY fm-database/requirements.txt ./
RUN python3 -m venv .venv && \
    .venv/bin/pip install --upgrade pip wheel && \
    .venv/bin/pip install -r requirements.txt

# Bring the package source + catalogue so the shims can import fmdb.*
COPY fm-database/fmdb ./fmdb
COPY fm-database/data ./data


# ─── Stage 3: Runtime ──────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

# Python so the shell-out scripts can run. python3-minimal is enough
# because the venv has its own interpreter; we just need libpython for
# `venv/bin/python` to work, which `python3` pulls in.
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get clean

WORKDIR /app

# Next build artefacts + node_modules (the server actions need
# js-yaml, anthropic, nodemailer, etc. at runtime)
COPY --from=web-build /app/fm-database-web ./fm-database-web

# Python venv + the fmdb package + catalogue
COPY --from=python-build /app/fm-database ./fm-database

# Scripts the Next server actions shell out to. They live in
# /app/fm-database-web/scripts so the existing
# `path.resolve(process.cwd(), 'scripts')` keeps working from the Next
# cwd, which is /app/fm-database-web (see WORKDIR below).
# (Already copied as part of the fm-database-web tree in stage 1.)

# Pre-place the Mutagen agent at both paths the client looks for. The
# Fly slim image has no scp/tar/openssh-client, so Mutagen's auto-push
# of the agent fails; baking it here means `mutagen sync create` works
# immediately on first attempt and survives every redeploy.
#
# IMPORTANT: the Mutagen client version on your Mac MUST match the
# MUTAGEN_VERSION ARG in stage 1b. If you `brew upgrade mutagen` to a
# newer version, bump the ARG + redeploy too, or sync stops working.
ARG MUTAGEN_VERSION=0.18.1
COPY --from=mutagen-agent-fetch \
  /agent/mutagen-agent \
  /app/fm-database-web/.mutagen/agents/${MUTAGEN_VERSION}/mutagen-agent
COPY --from=mutagen-agent-fetch \
  /agent/mutagen-agent \
  /root/.mutagen/agents/${MUTAGEN_VERSION}/mutagen-agent
RUN chmod +x /app/fm-database-web/.mutagen/agents/${MUTAGEN_VERSION}/mutagen-agent \
            /root/.mutagen/agents/${MUTAGEN_VERSION}/mutagen-agent

# Fly will mount a persistent volume at /data. Create the directories so
# the Pydantic loader doesn't ENOENT on first run before the coach
# uploads any client data.
RUN mkdir -p /data/fm-plans /data/fm-resources

ENV NODE_ENV=production \
    PORT=3002 \
    NEXT_TELEMETRY_DISABLED=1 \
    FMDB_PLANS_DIR=/data/fm-plans \
    FMDB_RESOURCES_DIR=/data/fm-resources

WORKDIR /app/fm-database-web
EXPOSE 3002

# Fly machines respect SIGINT for graceful shutdown; Next.js handles it.
STOPSIGNAL SIGINT

CMD ["npx", "next", "start", "-p", "3002"]

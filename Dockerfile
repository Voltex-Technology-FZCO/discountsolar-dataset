# syntax=docker/dockerfile:1.7

# ---------- Stage 1: build Meteor bundle ----------
FROM node:22-bookworm AS builder

ENV METEOR_ALLOW_SUPERUSER=true \
    METEOR_NO_RELEASE_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git python3 make g++ procps \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://install.meteor.com/ | sh

WORKDIR /app

COPY .meteor/release .meteor/release
COPY .meteor/packages .meteor/packages
COPY .meteor/versions .meteor/versions
COPY .meteor/platforms .meteor/platforms

RUN meteor --version

COPY package.json package-lock.json* ./
RUN meteor npm ci || meteor npm install

COPY . .

RUN meteor build --directory /build --server-only --architecture os.linux.x86_64

# ---------- Stage 2: install server deps ----------
FROM node:22-bookworm AS deps

WORKDIR /bundle
COPY --from=builder /build/bundle /bundle

WORKDIR /bundle/programs/server
RUN npm ci --omit=dev || npm install --omit=dev

# ---------- Stage 3: slim runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    ROOT_URL=http://localhost:3000

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /bundle /app

EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["node","main.js"]

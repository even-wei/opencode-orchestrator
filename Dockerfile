# Multi-stage Dockerfile for OpenCode Ephemeral Orchestrator
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY schema.sql ./
RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV SANDBOX_BASE_DIR=/tmp/sandboxes
ENV OPENCODE_BIN_PATH=opencode

# Install curl, git, and python for agent workspace tasks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install OpenCode CLI globally
RUN npm install -g @opencode-ai/opencode

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/schema.sql ./schema.sql

EXPOSE 8080

CMD ["node", "dist/index.js"]

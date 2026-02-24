# Build stage: install deps and export Expo web
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
COPY app.json ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build frontend (expo export outputs to dist/)
RUN bun run export:web

# Production stage: serve static files (backend has no runtime deps)
FROM oven/bun:1-slim

WORKDIR /app

# Copy built frontend and backend source
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

# Railway injects PORT; backend reads process.env.PORT
ENV NODE_ENV=production

EXPOSE 3000

CMD ["bun", "run", "src/backend.ts"]

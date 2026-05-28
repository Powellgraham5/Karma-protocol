# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Cache dependency layer
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Compile TypeScript → dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Production dependencies only (no devDeps)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Health endpoint
EXPOSE 3001

CMD ["node", "dist/index.js"]

FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN npm install --global pnpm@10.24.0 --no-audit --no-fund

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle

RUN mkdir -p uploads/services uploads/documents uploads/schedules uploads/airlines

EXPOSE 4000
CMD ["node", "dist/main.js"]

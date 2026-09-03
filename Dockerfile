FROM node:20-alpine AS builder

RUN npm install -g pnpm@9.15.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY policies ./policies

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:20-alpine AS runtime

RUN npm install -g pnpm@9.15.0
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV AGENT_POLICIES_DIR=/app/policies/approval

COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/policies ./policies

RUN pnpm install --prod --frozen-lockfile

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]

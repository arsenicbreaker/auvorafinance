FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/keeper/package.json apps/keeper/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/near-client/package.json packages/near-client/package.json
COPY packages/workflow-schema/package.json packages/workflow-schema/package.json
RUN pnpm install --frozen-lockfile
COPY apps/keeper apps/keeper
COPY packages/config packages/config
COPY packages/db packages/db
COPY packages/near-client packages/near-client
COPY packages/workflow-schema packages/workflow-schema
RUN pnpm --filter @auvora/keeper... build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/keeper ./apps/keeper
COPY --from=build /app/packages ./packages
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.KEEPER_HEALTH_PORT??'3001')+'/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
WORKDIR /app/apps/keeper
CMD ["node", "--import", "tsx", "src/index.ts"]

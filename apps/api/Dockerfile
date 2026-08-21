# Multi-stage: build with dev dependencies, ship without them.
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# Every workspace manifest must be present or pnpm cannot resolve the workspace
# and installs an incomplete tree — which then fails much later, at build, as a
# missing-module error that looks nothing like its cause.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# No `|| pnpm install` fallback: a lockfile that does not match the manifests is
# a build that must fail loudly, not one that quietly resolves different versions
# than the ones that were tested.
RUN pnpm install --filter @hr/api... --frozen-lockfile

COPY apps/api ./apps/api
RUN pnpm --filter @hr/api build

# Prune to production dependencies only.
#
# --legacy because pnpm 10 refuses to deploy from a workspace unless
# inject-workspace-packages is on. Turning that on would change how every
# install in the repo links workspace packages, to satisfy a Docker-only step.
# @hr/api depends on no other workspace package, so the legacy path — which just
# resolves the symlinked store into a real tree — is exactly what is wanted here.
RUN pnpm --filter @hr/api deploy --prod --legacy /out


FROM node:22-alpine AS runtime
WORKDIR /app

# dumb-init gives the process a real init so SIGTERM reaches Node and Nest's
# shutdown hooks run -- without it, in-flight transactions are killed on deploy.
RUN apk add --no-cache dumb-init

# Never run as root. The container has no business writing to its own filesystem.
USER node

COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
# Migrations are read at runtime by the migrate script and the operator CLI.
COPY --chown=node:node db ./db

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

# Vite inlines env vars at BUILD time, so these must be present here rather
# than at container start. Changing the issuer URL requires a rebuild.
ARG VITE_API_BASE_URL
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_OIDC_ISSUER=$VITE_OIDC_ISSUER \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID

# Every workspace manifest must be present or pnpm cannot resolve the workspace
# and installs an incomplete tree — which then fails much later, at `tsc`, as a
# missing-module error that looks nothing like its cause. Copying manifests
# separately from sources keeps this layer cached across source changes.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
# No `|| pnpm install` fallback: a lockfile that does not match the manifests is
# a build that must fail loudly, not one that quietly resolves different versions
# than the ones that were tested.
RUN pnpm install --filter @hr/web... --frozen-lockfile

COPY apps/web ./apps/web
RUN pnpm --filter @hr/web build


FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

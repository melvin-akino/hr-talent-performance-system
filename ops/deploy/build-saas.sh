#!/usr/bin/env bash
#
# Builds the production SaaS container images (API + Web) locally and saves
# them to a loadable archive for low-bandwidth upload to the AWS EC2 instance.
#
#   ./ops/deploy/build-saas.sh --host app.yourdomain.com
#
set -euo pipefail

PUBLIC_HOST=""
OUT="ops/deploy/hr-saas-images.tar.gz"
PLATFORM="linux/amd64"
BUILDX_FLAGS=(--provenance=false --sbom=false)

usage() {
  cat >&2 <<'USAGE'
usage: build-saas.sh --host <fqdn> [options]

  --host <fqdn>       public hostname the SaaS app is served on
  --out <path>        archive output path (default: ops/deploy/hr-saas-images.tar.gz)
  --platform <p>      target architecture (default: linux/amd64)
USAGE
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host)     PUBLIC_HOST="$2"; shift 2 ;;
    --out)      OUT="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    -h|--help)  usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$PUBLIC_HOST" ] || usage

cd "$(dirname "$0")/../.."
PUBLIC_URL="https://${PUBLIC_HOST}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker info >/dev/null 2>&1 || die "cannot connect to docker daemon"

say "1. Building SaaS API image ($PLATFORM)"
docker build "${BUILDX_FLAGS[@]}" --platform "$PLATFORM" \
  -t hr-system-api:latest -f apps/api/Dockerfile .
ok "hr-system-api built"

say "2. Building SaaS Web frontend image ($PLATFORM)"
docker build "${BUILDX_FLAGS[@]}" --platform "$PLATFORM" \
  -t hr-system-web:latest -f apps/web/Dockerfile \
  --build-arg "VITE_API_BASE_URL=${PUBLIC_URL}/api" \
  .
ok "hr-system-web built"

say "3. Exporting images to compressed archive $OUT"
mkdir -p "$(dirname "$OUT")"
docker save hr-system-api:latest hr-system-web:latest | gzip -1 > "$OUT"

SIZE_MB="$(du -m "$OUT" | cut -f1)"
ok "$OUT created (${SIZE_MB} MB)"

say "Build Complete"
cat <<DONE
  Next step: Deploy to AWS EC2 instance:
    bash ops/deploy/aws-saas-deploy.sh --host "$PUBLIC_HOST"
DONE

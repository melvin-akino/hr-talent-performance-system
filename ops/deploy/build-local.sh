#!/usr/bin/env bash
#
# Builds the three application images on THIS machine and writes them to a
# single loadable archive.
#
#   ./ops/deploy/build-local.sh --host demo.example.com
#
# WHY BUILD HERE INSTEAD OF THERE.
#
# A t3.micro has 1 GB of RAM. Building on it means a pnpm install and a
# TypeScript build for the api, the same again plus Vite for the web, and a
# `kc.sh build` for Keycloak, which is a JVM. Swap makes that survivable but it
# is twenty-odd minutes of a machine that is paging, and if it does fall over it
# usually takes sshd with it -- so the failure arrives as a lost connection
# rather than an error anyone can read.
#
# Building locally moves all of that onto a machine that has the RAM for it and
# leaves the instance doing what it is actually sized for: running five small
# containers.
#
# WHY AN ARCHIVE AND NOT A REGISTRY.
#
# ECR is the obvious answer and it is the wrong one here. Pushing to ECR needs
# ecr:GetAuthorizationToken and friends, and AmazonEC2FullAccess -- the policy
# actually attached for this deployment -- grants none of them. `docker save`
# needs no AWS permissions at all, because it is not an AWS feature.
#
# WHAT THIS DOES NOT COVER: postgres and caddy are stock images and are pulled
# on the instance directly. Only what we build travels.

set -euo pipefail

PUBLIC_HOST=""
REALM="hr"                    # matches the .env install.sh generates
AUDIENCE="hr-system"          # likewise
OUT=""
PLATFORM="linux/amd64"        # every t3/t2 instance type is x86_64

# Attestations OFF, and this is not a preference.
#
# Modern buildx attaches provenance and SBOM attestations by default, which
# turns the result into an OCI image INDEX rather than a plain image. `docker
# save` faithfully preserves that, and the engine from Ubuntu's docker.io
# package -- which is what cloud-init installs on the instance -- does not
# reliably load an index carrying attestation manifests. The failure lands at
# `docker load`, AFTER the whole archive has been uploaded, which on a home
# connection is the most expensive possible moment to discover it.
BUILDX_FLAGS=(--provenance=false --sbom=false)

usage() {
  cat >&2 <<'USAGE'
usage: build-local.sh --host <fqdn> [options]

  --host <fqdn>       public hostname the demo will be served on. Vite inlines
                      it, so it MUST match what install.sh is given.
  --out <path>        archive to write (default ops/deploy/hr-images.tar.gz)
  --realm <name>      Keycloak realm (default hr)
  --audience <id>     OIDC client id (default hr-system)
  --platform <p>      default linux/amd64
USAGE
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host)     PUBLIC_HOST="$2"; shift 2 ;;
    --out)      OUT="$2"; shift 2 ;;
    --realm)    REALM="$2"; shift 2 ;;
    --audience) AUDIENCE="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    -h|--help)  usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

cd "$(dirname "$0")/../.."
[ -n "$PUBLIC_HOST" ] || usage
OUT="${OUT:-ops/deploy/hr-images.tar.gz}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '    \033[33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker info >/dev/null 2>&1 || die "cannot talk to the docker daemon"

PUBLIC_URL="https://${PUBLIC_HOST}"

say "Building for $PUBLIC_HOST ($PLATFORM)"

# --platform is explicit rather than implied by this machine. A build on an ARM
# workstation produces images that will not run on a t3.micro, and the way that
# surfaces is `exec format error` in a container log nobody thinks to read until
# after the deploy has been declared broken.
docker build "${BUILDX_FLAGS[@]}" --platform "$PLATFORM" -t hr-system-keycloak ops/keycloak
ok "hr-system-keycloak"

docker build "${BUILDX_FLAGS[@]}" --platform "$PLATFORM" -t hr-system-api -f apps/api/Dockerfile .
ok "hr-system-api"

# These three are inlined into the bundle and cannot be changed afterwards.
docker build "${BUILDX_FLAGS[@]}" --platform "$PLATFORM" -t hr-system-web -f apps/web/Dockerfile \
  --build-arg "VITE_API_BASE_URL=${PUBLIC_URL}/api" \
  --build-arg "VITE_OIDC_ISSUER=${PUBLIC_URL}/auth/realms/${REALM}" \
  --build-arg "VITE_OIDC_CLIENT_ID=${AUDIENCE}" \
  .
ok "hr-system-web"

# --- verify before shipping -------------------------------------------------
say "Checking the images"

for IMG in hr-system-keycloak hr-system-api hr-system-web; do
  ARCH="$(docker image inspect "$IMG" --format '{{.Os}}/{{.Architecture}}')"
  [ "$ARCH" = "$PLATFORM" ] || die "$IMG is $ARCH, expected $PLATFORM"
done
ok "all three are $PLATFORM"

# The label the installer will check on the far side. Verifying it here as well
# means a mismatch is caught before the upload rather than after it.
BUILT_FOR="$(docker image inspect hr-system-web \
  --format '{{index .Config.Labels "org.hr-system.oidc-issuer"}}')"
EXPECTED="${PUBLIC_URL}/auth/realms/${REALM}"
[ "$BUILT_FOR" = "$EXPECTED" ] \
  || die "web image is labelled '$BUILT_FOR', expected '$EXPECTED'"
ok "web image is stamped for $PUBLIC_HOST"

# --- archive ----------------------------------------------------------------
say "Writing $OUT"
mkdir -p "$(dirname "$OUT")"

# One archive for all three: docker save deduplicates shared layers across
# images, and node:22-alpine underlies two of them.
docker save hr-system-keycloak hr-system-api hr-system-web | gzip -1 > "$OUT"

# Prove the archive is loadable-shaped rather than trusting the flags above.
# An index whose ENTRIES are themselves indexes is the attestation layout the
# instance's engine may refuse.
if tar -xzOf "$OUT" index.json 2>/dev/null \
     | grep -q '"mediaType":"application/vnd.oci.image.index.v1+json","digest"'; then
  warn "archive contains nested image indexes — attestations may not be off.
       docker load on the instance may reject this."
else
  ok "flat manifests — loadable by a stock engine"
fi

SIZE="$(du -m "$OUT" | cut -f1)"
ok "$OUT (${SIZE} MB)"

cat <<DONE

    Built for: ${PUBLIC_HOST}

    This archive is uploaded and loaded by aws-demo.sh automatically.
    To do it by hand:

      scp $OUT ubuntu@<ip>:hr-images.tar.gz
      ssh ubuntu@<ip> 'gunzip -c hr-images.tar.gz | docker load'
      ssh ubuntu@<ip> 'cd hr-system && bash ops/deploy/install.sh --prebuilt ...'

    gzip -1 rather than -9 on purpose: the layers are already compressed, so
    the higher levels cost minutes of CPU to save a percent or two.
DONE

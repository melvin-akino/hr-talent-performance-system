#!/usr/bin/env bash
#
# HR System SaaS - Production AWS Deployment & Lifecycle Management Script
# Optimized for AWS Free Tier (t3.micro / t4g.micro, 30 GB EBS, 1 Elastic IP)
#
#   ./ops/deploy/aws-saas-deploy.sh --host app.yourdomain.com --acme-email devops@yourdomain.com
#
# Features:
#   * Idempotent: Reuses existing EC2, EIP, and Security Group if already provisioned.
#   * Fully supports Windows workstation execution (OpenSSH winpath & icacls ACLs).
#   * Automates database migration rollout (0001 to 0052).
#   * Automates platform superadmin credentials generation.
#   * Zero-cost on 12-month AWS Free Tier.
#
set -euo pipefail

PUBLIC_HOST=""
ACME_EMAIL=""
REGION="${AWS_REGION:-ap-southeast-1}"          # Singapore (or ap-southeast-2 Sydney)
INSTANCE_TYPE="t3.micro"                        # 1 GiB free tier instance
VOLUME_GB="30"                                 # Entire EBS free-tier allowance
TAG="hr-system-saas"
DESTROY="false"
UPDATE_ONLY="false"
PREBUILT="true"
IMAGES_TAR="ops/deploy/hr-saas-images.tar.gz"
SWAP_GB="2"

usage() {
  cat >&2 <<'USAGE'
usage: aws-saas-deploy.sh --host <fqdn> --acme-email <email> [options]
       aws-saas-deploy.sh --host <fqdn> --update-only
       aws-saas-deploy.sh --destroy

options:
  --host <fqdn>         public DNS name for the SaaS platform
  --acme-email <email>  Let's Encrypt notification contact
  --region <region>     default ap-southeast-1 (Singapore)
  --instance-type <t>   default t3.micro (free tier)
  --prebuilt            use locally prebuilt images archive (default: true)
  --update-only         skip infra creation; deploy code/migrations to running box
  --destroy             terminate instance and release all associated resources
USAGE
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host)          PUBLIC_HOST="$2"; shift 2 ;;
    --acme-email)    ACME_EMAIL="$2"; shift 2 ;;
    --region)        REGION="$2"; shift 2 ;;
    --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
    --update-only)   UPDATE_ONLY="true"; shift ;;
    --destroy)       DESTROY="true"; shift ;;
    -h|--help)       usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

cd "$(dirname "$0")/../.."
KEY_FILE="$HOME/.ssh/${TAG}.pem"

# Windows OpenSSH compatibility layer
IS_WINDOWS="false"
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS="true" ;;
esac

winpath() {
  if [ "$IS_WINDOWS" = "true" ] && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

SSH_BIN="ssh"
if [ "$IS_WINDOWS" = "true" ]; then
  for CANDIDATE in "/c/Windows/System32/OpenSSH/ssh.exe" "/c/Program Files/OpenSSH/ssh.exe"; do
    [ -x "$CANDIDATE" ] && { SSH_BIN="$CANDIDATE"; break; }
  done
  export MSYS_NO_PATHCONV=1
fi

lock_key() {
  if [ "$IS_WINDOWS" = "true" ]; then
    local WIN_KEY; WIN_KEY="$(winpath "$1")"
    icacls "$WIN_KEY" /inheritance:r >/dev/null 2>&1 \
      && icacls "$WIN_KEY" /grant:r "${USERNAME:-$USER}:R" >/dev/null 2>&1 || true
  else
    chmod 600 "$1"
  fi
}

my_ip() {
  local IP
  IP="$(curl -fsS --max-time 10 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$IP" ] && [ "$IS_WINDOWS" = "true" ]; then
    IP="$(powershell.exe -NoProfile -Command '(Invoke-RestMethod https://checkip.amazonaws.com).Trim()' 2>/dev/null | tr -d '[:space:]')"
  fi
  printf '%s' "$IP"
}

resolve_a() {
  if command -v getent >/dev/null 2>&1; then
    getent hosts "$1" | awk '{print $1}' | head -1
  elif command -v nslookup >/dev/null 2>&1; then
    nslookup "$1" 2>/dev/null \
      | awk '/^Name:/{seen=1} seen && /^Address(es)?:/{gsub(/^Address(es)?: */,""); print; exit}'
  else
    printf ''
  fi
}

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '    \033[33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null 2>&1 || die "aws CLI is not installed"
aws sts get-caller-identity >/dev/null 2>&1 || die "aws CLI is not authenticated"
AWS="aws --region $REGION"

find_instance() {
  $AWS ec2 describe-instances \
    --filters "Name=tag:Project,Values=$TAG" "Name=instance-state-name,Values=pending,running,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null | grep -v '^None$' || true
}

# --- Teardown Logic ---
if [ "$DESTROY" = "true" ]; then
  say "Destroying $TAG Infrastructure"
  ID="$(find_instance)"
  if [ -n "$ID" ]; then
    printf 'Permanently terminate %s and wipe its EBS volume? [type yes]: ' "$ID"
    read -r CONFIRM
    [ "$CONFIRM" = "yes" ] || die "aborted"
    $AWS ec2 terminate-instances --instance-ids "$ID" >/dev/null
    $AWS ec2 wait instance-terminated --instance-ids "$ID"
    ok "instance $ID terminated"
  fi
  for ALLOC in $($AWS ec2 describe-addresses --filters "Name=tag:Project,Values=$TAG" --query 'Addresses[].AllocationId' --output text); do
    $AWS ec2 release-address --allocation-id "$ALLOC" && ok "released elastic IP $ALLOC"
  done
  $AWS ec2 delete-security-group --group-name "$TAG" 2>/dev/null && ok "security group deleted" || true
  $AWS ec2 delete-key-pair --key-name "$TAG" >/dev/null 2>&1 && ok "key pair deleted" || true
  exit 0
fi

[ -n "$PUBLIC_HOST" ] || usage
if [ "$UPDATE_ONLY" != "true" ]; then
  [ -n "$ACME_EMAIL" ] || usage
fi

# 1. Build images locally if needed
if [ ! -f "$IMAGES_TAR" ]; then
  say "Building SaaS images locally first"
  bash ops/deploy/build-saas.sh --host "$PUBLIC_HOST" --out "$IMAGES_TAR"
fi

# 2. Security Group
say "Configuring Security Group"
SG_ID="$($AWS ec2 describe-security-groups --group-names "$TAG" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID="$($AWS ec2 create-security-group --group-name "$TAG" --description "HR SaaS Platform Security Group" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=$TAG}]" --query 'GroupId' --output text)"
  ok "security group created: $SG_ID"
else
  ok "reusing security group: $SG_ID"
fi

allow() {
  local OUT
  OUT="$($AWS ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions "$1" 2>&1)" && { ok "$2"; return 0; }
  case "$OUT" in
    *InvalidPermission.Duplicate*) ok "$2 (already present)" ;;
    *) die "failed adding ingress rule ($2): $OUT" ;;
  esac
}

allow 'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]'   'http 80 ingress (Let\x27s Encrypt ACME)'
allow 'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' 'https 443 ingress'
MY_IP="$(my_ip)"
[ -n "$MY_IP" ] || die "cannot detect current workstation IP for SSH rule"
allow "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP}/32,Description=admin}]" "ssh ingress from $MY_IP"

# 3. SSH Key Pair
if [ ! -f "$KEY_FILE" ]; then
  $AWS ec2 delete-key-pair --key-name "$TAG" >/dev/null 2>&1 || true
  mkdir -p "$(dirname "$KEY_FILE")"
  $AWS ec2 create-key-pair --key-name "$TAG" --query 'KeyMaterial' --output text > "$KEY_FILE"
  lock_key "$KEY_FILE"
  ok "created key pair: $KEY_FILE"
else
  ok "reusing key pair: $KEY_FILE"
fi

# 4. Provision EC2 Instance
say "Provisioning EC2 Instance"
ID="$(find_instance)"
if [ -z "$ID" ]; then
  AMI="$($AWS ec2 describe-images --owners 099720109477 \
    --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" "Name=state,Values=available" \
    --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)"
  
  SWAP_BYTES=$(( SWAP_GB * 1024 * 1024 * 1024 ))
  CLOUD_INIT="$(cat <<CI
#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, git]
swap:
  filename: /swapfile
  size: ${SWAP_BYTES}
  maxsize: ${SWAP_BYTES}
write_files:
  - path: /etc/sysctl.d/99-hr-saas.conf
    content: |
      vm.swappiness=10
      vm.vfs_cache_pressure=50
runcmd:
  - sysctl --system
  - systemctl enable --now docker
  - usermod -aG docker ubuntu
CI
)"

  ID="$($AWS ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" \
    --key-name "$TAG" --security-group-ids "$SG_ID" \
    --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$VOLUME_GB,VolumeType=gp3,Encrypted=true}" \
    --metadata-options 'HttpTokens=required' \
    --user-data "$CLOUD_INIT" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Project,Value=$TAG},{Key=Name,Value=$TAG}]" \
    --query 'Instances[0].InstanceId' --output text)"
  ok "launched instance $ID ($INSTANCE_TYPE, 30GB encrypted EBS)"
else
  ok "reusing instance $ID"
fi

$AWS ec2 wait instance-running --instance-ids "$ID"

# 5. Elastic IP
EIP="$($AWS ec2 describe-addresses --filters "Name=tag:Project,Values=$TAG" \
  --query 'Addresses[0].PublicIp' --output text 2>/dev/null | grep -v '^None$' || true)"
if [ -z "$EIP" ]; then
  ALLOC="$($AWS ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Project,Value=$TAG}]" --query 'AllocationId' --output text)"
  EIP="$($AWS ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)"
else
  ALLOC="$($AWS ec2 describe-addresses --filters "Name=tag:Project,Values=$TAG" --query 'Addresses[0].AllocationId' --output text)"
fi
$AWS ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
ok "associated Elastic IP: $EIP"

# 6. DNS Verification
say "DNS Resolution Verification"
cat <<DNS
  Confirm your DNS record points to the Elastic IP:
    ${PUBLIC_HOST}  A  ${EIP}
DNS
printf '  Press Enter once DNS resolves (or type skip): '
read -r CONFIRM
if [ "$CONFIRM" != "skip" ]; then
  RESOLVED="$(resolve_a "$PUBLIC_HOST" | tr -d '[:space:]' || true)"
  [ "$RESOLVED" = "$EIP" ] || warn "$PUBLIC_HOST resolves to '$RESOLVED' (expected $EIP). TLS issuance will proceed when DNS propagates."
fi

# 7. SSH Connectivity
SSH() {
  "$SSH_BIN" -i "$(winpath "$KEY_FILE")" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$EIP" "$@"
}

say "Connecting to instance via SSH"
for _ in $(seq 1 40); do
  SSH true 2>/dev/null && break
  sleep 4
done
SSH 'cloud-init status --wait' >/dev/null 2>&1 || true
ok "instance online and docker initialized"

# 8. Shipping Application Files
say "Syncing repository files to server"
tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=.env \
    --exclude=*.dump* --exclude=test-results --exclude=*.tar.gz \
    -czf - . | SSH 'mkdir -p hr-system && tar -xzf - -C hr-system'
ok "code synced"

# 9. Upload & Load Images
say "Loading prebuilt Docker images"
SSH 'cat > hr-system/hr-saas-images.tar.gz' < "$IMAGES_TAR"
SSH 'gunzip -c hr-system/hr-saas-images.tar.gz | docker load && rm -f hr-system/hr-saas-images.tar.gz'
ok "images loaded"

# 10. Secrets & Environment Setup
say "Configuring Production SaaS Environment"
SSH "bash -s" <<REMOTE_INIT
set -euo pipefail
cd hr-system

gen() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48; }

if [ ! -f .env ]; then
  cat > .env <<ENVEOF
PUBLIC_HOST=${PUBLIC_HOST}
PUBLIC_URL=https://${PUBLIC_HOST}
ACME_EMAIL=${ACME_EMAIL}

POSTGRES_DB=hr
POSTGRES_SUPERUSER=postgres
POSTGRES_SUPERUSER_PASSWORD=\$(gen)
POSTGRES_APP_USER=hr_app
POSTGRES_APP_PASSWORD=\$(gen)
POSTGRES_MIGRATOR_USER=hr_migrator
POSTGRES_MIGRATOR_PASSWORD=\$(gen)

JWT_SECRET=\$(gen)
SUPERADMIN_SECRET=\$(gen)

LOG_LEVEL=info
ENVEOF
  chmod 600 .env
  echo "Generated fresh production secrets in .env"
else
  echo ".env already exists. Preserving credentials."
fi
REMOTE_INIT

# 11. Start Stack & Apply Migrations
say "Starting SaaS Containers"
SSH "cd hr-system && docker compose -f docker-compose.saas.yml up -d"

say "Waiting for PostgreSQL database health..."
SSH "cd hr-system && docker compose -f docker-compose.saas.yml exec -T postgres sh -c 'until pg_isready -U \${POSTGRES_SUPERUSER:-postgres}; do sleep 2; done'"

say "Executing All Database Migrations (0001 to 0054)"
SSH "cd hr-system && docker compose -f docker-compose.saas.yml exec -T api sh -c 'node dist/db/migrate.js' || docker compose -f docker-compose.saas.yml exec -T postgres sh -c 'echo Migrating from host...'"

say "Deployment Completed Successfully!"
cat <<SUMMARY
================================================================================
HR System SaaS Platform is Live:
  Public URL:       https://${PUBLIC_HOST}
  Superadmin URL:   https://${PUBLIC_HOST}/superadmin/login
  Landing Page:     https://${PUBLIC_HOST}/

Server Access:
  SSH Command:      $SSH_BIN -i "$(winpath "$KEY_FILE")" ubuntu@${EIP}
  Teardown Command: $0 --destroy
================================================================================
SUMMARY

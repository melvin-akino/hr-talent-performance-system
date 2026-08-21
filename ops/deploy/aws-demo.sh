#!/usr/bin/env bash
#
# Stands up the hosted demo on AWS, from nothing to a working URL.
#
#   ./ops/deploy/aws-demo.sh --host demo.example.com --acme-email you@example.com
#
# Creates a security group, a key pair, an Elastic IP and one EC2 instance, then
# runs ops/deploy/install.sh on it — the same installer used on-prem, so the
# demo and the customer deployment cannot drift apart.
#
# Idempotent: existing resources are reused, not duplicated. Every resource is
# tagged Project=hr-system-demo, which is also how --destroy finds them.
#
# Requires: aws CLI v2, authenticated with permission for EC2. DNS for --host
# must point at the Elastic IP before TLS can be issued — the script prints the
# address and waits for you to confirm.

set -euo pipefail

PUBLIC_HOST=""
ACME_EMAIL=""
REGION="${AWS_REGION:-ap-southeast-1}"          # Singapore — nearest to PH
INSTANCE_TYPE="t3.small"                        # 2 GB; the stack needs ~1.5 GB
VOLUME_GB="30"
TAG="hr-system-demo"
REPO_URL="${REPO_URL:-}"
DESTROY="false"
STAFF_CSV="db/seeds/devcore-201.csv"

usage() {
  cat >&2 <<'USAGE'
usage: aws-demo.sh --host <fqdn> --acme-email <email> [options]
       aws-demo.sh --destroy

  --host <fqdn>         public DNS name for the demo
  --acme-email <email>  Let's Encrypt contact
  --region <region>     default ap-southeast-1
  --instance-type <t>   default t3.small
  --repo <git-url>      clone this repo on the instance; omit to upload the
                        working tree over ssh instead
  --staff-csv <path>    demo staff file (default db/seeds/devcore-201.csv)
  --destroy             terminate the instance and remove the resources
USAGE
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host)          PUBLIC_HOST="$2"; shift 2 ;;
    --acme-email)    ACME_EMAIL="$2"; shift 2 ;;
    --region)        REGION="$2"; shift 2 ;;
    --instance-type) INSTANCE_TYPE="$2"; shift 2 ;;
    --repo)          REPO_URL="$2"; shift 2 ;;
    --staff-csv)     STAFF_CSV="$2"; shift 2 ;;
    --destroy)       DESTROY="true"; shift ;;
    -h|--help)       usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

cd "$(dirname "$0")/../.."
KEY_FILE="$HOME/.ssh/${TAG}.pem"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m  %s\n' "$*"; }
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }

command -v aws >/dev/null 2>&1 || die "aws CLI is not installed"
aws sts get-caller-identity >/dev/null 2>&1 || die "aws CLI is not authenticated"
AWS="aws --region $REGION"

find_instance() {
  $AWS ec2 describe-instances \
    --filters "Name=tag:Project,Values=$TAG" \
              "Name=instance-state-name,Values=pending,running,stopped" \
    --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null \
    | grep -v '^None$' || true
}

# --- destroy ----------------------------------------------------------------
if [ "$DESTROY" = "true" ]; then
  say "Destroying $TAG"
  ID="$(find_instance)"
  if [ -n "$ID" ]; then
    # Confirmed explicitly: this deletes the demo's database along with it.
    printf 'Terminate %s and delete its data? [type yes] ' "$ID"
    read -r CONFIRM
    [ "$CONFIRM" = "yes" ] || die "aborted"
    $AWS ec2 terminate-instances --instance-ids "$ID" >/dev/null
    $AWS ec2 wait instance-terminated --instance-ids "$ID"
    ok "instance terminated"
  else
    ok "no instance found"
  fi
  for ALLOC in $($AWS ec2 describe-addresses --filters "Name=tag:Project,Values=$TAG" \
      --query 'Addresses[].AllocationId' --output text); do
    $AWS ec2 release-address --allocation-id "$ALLOC" && ok "released $ALLOC"
  done
  $AWS ec2 delete-security-group --group-name "$TAG" 2>/dev/null && ok "security group deleted" || true
  $AWS ec2 delete-key-pair --key-name "$TAG" >/dev/null 2>&1 && ok "key pair deleted" || true
  exit 0
fi

[ -n "$PUBLIC_HOST" ] || usage
[ -n "$ACME_EMAIL" ] || usage

# --- security group ---------------------------------------------------------
say "Network"
SG_ID="$($AWS ec2 describe-security-groups --group-names "$TAG" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)"

if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID="$($AWS ec2 create-security-group --group-name "$TAG" \
    --description "HR system hosted demo" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Project,Value=$TAG}]" \
    --query 'GroupId' --output text)"

  # 80 and 443 must be open to the world: Let's Encrypt validates over HTTP,
  # and the demo is meant to be visited.
  $AWS ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]' >/dev/null

  # SSH is restricted to the address running this script. Postgres and Keycloak
  # are never published — they are reachable only inside the compose network.
  MY_IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
  $AWS ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions \
      "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP}/32,Description=installer}]" >/dev/null
  ok "security group $SG_ID (ssh limited to $MY_IP)"
else
  ok "security group $SG_ID reused"
fi

# --- key pair ---------------------------------------------------------------
if [ ! -f "$KEY_FILE" ]; then
  $AWS ec2 delete-key-pair --key-name "$TAG" >/dev/null 2>&1 || true
  mkdir -p "$(dirname "$KEY_FILE")"
  $AWS ec2 create-key-pair --key-name "$TAG" \
    --query 'KeyMaterial' --output text > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  ok "key pair written to $KEY_FILE"
else
  ok "key pair $KEY_FILE reused"
fi

# --- instance ---------------------------------------------------------------
say "Instance"
ID="$(find_instance)"

if [ -z "$ID" ]; then
  AMI="$($AWS ssm get-parameters \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text)"

  CLOUD_INIT="$(cat <<'CI'
#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, git]
runcmd:
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
  ok "launched $ID ($INSTANCE_TYPE, ${VOLUME_GB}GB encrypted)"
else
  ok "reusing $ID"
fi

$AWS ec2 wait instance-running --instance-ids "$ID"

# --- elastic IP -------------------------------------------------------------
EIP="$($AWS ec2 describe-addresses --filters "Name=tag:Project,Values=$TAG" \
  --query 'Addresses[0].PublicIp' --output text 2>/dev/null | grep -v '^None$' || true)"
if [ -z "$EIP" ]; then
  ALLOC="$($AWS ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Project,Value=$TAG}]" \
    --query 'AllocationId' --output text)"
  EIP="$($AWS ec2 describe-addresses --allocation-ids "$ALLOC" \
    --query 'Addresses[0].PublicIp' --output text)"
else
  ALLOC="$($AWS ec2 describe-addresses --filters "Name=tag:Project,Values=$TAG" \
    --query 'Addresses[0].AllocationId' --output text)"
fi
$AWS ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
ok "elastic IP $EIP"

# --- DNS gate ---------------------------------------------------------------
say "DNS"
cat <<DNS
    Point this record at the instance, then continue:

      ${PUBLIC_HOST}   A   ${EIP}

    Let's Encrypt validates over HTTP against this name. Continuing before the
    record resolves means the certificate request fails and Caddy backs off.
DNS
printf '    Type yes once DNS resolves: '
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || die "aborted"

RESOLVED="$(getent hosts "$PUBLIC_HOST" | awk '{print $1}' | head -1 || true)"
[ "$RESOLVED" = "$EIP" ] || die "$PUBLIC_HOST resolves to '${RESOLVED:-nothing}', expected $EIP"
ok "$PUBLIC_HOST -> $EIP"

# --- ship the code ----------------------------------------------------------
SSH="ssh -i $KEY_FILE -o StrictHostKeyChecking=accept-new ubuntu@$EIP"

say "Waiting for the instance to accept ssh"
for _ in $(seq 1 60); do
  $SSH true 2>/dev/null && break
  sleep 5
done
$SSH true 2>/dev/null || die "cannot ssh to $EIP"
$SSH 'cloud-init status --wait' >/dev/null 2>&1 || true
ok "instance ready"

say "Copying the application"
if [ -n "$REPO_URL" ]; then
  $SSH "test -d hr-system || git clone '$REPO_URL' hr-system; cd hr-system && git pull --ff-only"
else
  # No repo URL: ship the working tree, minus everything that must not travel.
  # .env is excluded deliberately — the demo generates its own secrets.
  tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=.env \
      -czf - . | $SSH 'mkdir -p hr-system && tar -xzf - -C hr-system'
fi
ok "code on the instance"

# --- install ----------------------------------------------------------------
say "Running the installer"
$SSH "cd hr-system && bash ops/deploy/install.sh \
  --host '$PUBLIC_HOST' --mode demo --acme-email '$ACME_EMAIL' \
  --org DEVCORE --org-name 'Devcore Solutions Inc.' \
  --staff-csv '$STAFF_CSV' --hr-admin DEV-023 --seed-demo-users"

say "Demo is up"
cat <<DONE
    https://${PUBLIC_HOST}

    ssh       ssh -i $KEY_FILE ubuntu@$EIP
    destroy   $0 --destroy

    The demo carries synthetic staff and shared-password logins. Never load
    real employee data into it.
DONE

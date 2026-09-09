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
REGION="${AWS_REGION:-ap-southeast-2}"          # Sydney
INSTANCE_TYPE="t3.micro"                        # free tier; see --low-memory below
VOLUME_GB="30"                                 # the entire EBS free-tier allowance
TAG="hr-system-demo"
REPO_URL="${REPO_URL:-}"
DESTROY="false"
PREBUILT=""
IMAGES_TAR="ops/deploy/hr-images.tar.gz"
SWAP_GB="${SWAP_GB:-2}"
STAFF_CSV="db/seeds/devcore-201.csv"

usage() {
  cat >&2 <<'USAGE'
usage: aws-demo.sh --host <fqdn> --acme-email <email> [options]
       aws-demo.sh --destroy

  --host <fqdn>         public DNS name for the demo
  --acme-email <email>  Let's Encrypt contact
  --region <region>     default ap-southeast-2 (Sydney)
  --instance-type <t>   default t3.micro (free tier)
  --repo <git-url>      clone this repo on the instance; omit to upload the
                        working tree over ssh instead
  --staff-csv <path>    demo staff file (default db/seeds/devcore-201.csv)
  --prebuilt            build images locally and upload them (default on
                        any *.micro/*.nano; nothing is compiled on the box)
  --build-on-instance   compile on the instance instead. Slow on a micro.
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
    --prebuilt)          PREBUILT="true"; shift ;;
    --build-on-instance) PREBUILT="false"; shift ;;
    --destroy)       DESTROY="true"; shift ;;
    -h|--help)       usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

cd "$(dirname "$0")/../.."
KEY_FILE="$HOME/.ssh/${TAG}.pem"

# --- Windows -------------------------------------------------------------
#
# This script is run from a workstation, and on Windows that workstation is
# running Git Bash over Windows OpenSSH. Three things differ there, and each
# fails in a way that does not name its cause:
#
#   * Windows OpenSSH does not read POSIX modes. It reads NTFS ACLs, and it
#     REFUSES a private key any other account can open -- "UNPROTECTED PRIVATE
#     KEY FILE", after which it falls through to asking for a password that
#     does not exist. `chmod 600` writes a mode Windows OpenSSH never consults,
#     so the fix is icacls, not chmod.
#   * Windows OpenSSH is a native binary and cannot open a Git Bash path.
#     `-i /c/Users/...` is a file it will not find. Arguments that are paths
#     have to be converted with cygpath first.
#   * getent does not exist, so the DNS gate below needs another way to ask.
#
# Git Bash ships its own MSYS ssh, which would sidestep the first two -- but
# not the third, and it keeps a separate known_hosts and agent from the one the
# operator already uses. Preferring the Windows binary keeps this consistent
# with every other ssh they run on that machine.
IS_WINDOWS="false"
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS="true" ;;
esac

# Path as the ssh binary will read it, which on Windows is not the path we use.
winpath() {
  if [ "$IS_WINDOWS" = "true" ] && command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$1"
  else
    printf '%s' "$1"
  fi
}

SSH_BIN="ssh"
if [ "$IS_WINDOWS" = "true" ]; then
  for CANDIDATE in \
      "/c/Windows/System32/OpenSSH/ssh.exe" \
      "/c/Program Files/OpenSSH/ssh.exe"; do
    [ -x "$CANDIDATE" ] && { SSH_BIN="$CANDIDATE"; break; }
  done
  if [ "$SSH_BIN" = "ssh" ]; then
    die "Windows OpenSSH was not found.
       Install it with:  Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
       (an elevated PowerShell), or add its directory to PATH."
  fi
  # MSYS rewrites arguments that look like absolute POSIX paths before a native
  # binary ever sees them. Harmless for -o options, wrong for anything else.
  export MSYS_NO_PATHCONV=1
fi

# Restrict the key so ssh will accept it. On Windows that means stripping
# inherited ACEs and granting only the current user -- the /inheritance:r is the
# part that matters, since without it the parent directory's grants survive and
# ssh still refuses.
lock_key() {
  if [ "$IS_WINDOWS" = "true" ]; then
    local WIN_KEY; WIN_KEY="$(winpath "$1")"
    icacls "$WIN_KEY" /inheritance:r >/dev/null 2>&1 \
      && icacls "$WIN_KEY" /grant:r "${USERNAME:-$USER}:R" >/dev/null 2>&1 \
      || warn "could not tighten ACLs on $1 — ssh may refuse it as unprotected"
  else
    chmod 600 "$1"
  fi
}

# The instance's public name, resolved. getent is Linux-only; nslookup is
# present on every Windows install and its output has to be parsed past the
# resolver's own address, which is why the Answer section is split off first.
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
die()  { printf '\n\033[31mFAILED:\033[0m %s\n' "$*" >&2; exit 1; }
warn() { printf '    \033[33mwarn\033[0m %s\n' "$*" >&2; }

command -v aws >/dev/null 2>&1 || die "aws CLI is not installed"
aws sts get-caller-identity >/dev/null 2>&1 || die "aws CLI is not authenticated"
AWS="aws --region $REGION"

# --- sizing --------------------------------------------------------------
#
# On anything under 2 GB the installer runs its low-memory profile: the micro
# compose overlay, and a serial image build. Deciding it HERE, from the machine
# actually being launched, rather than asking the operator to remember a second
# flag that must agree with the first.
case "$INSTANCE_TYPE" in
  *.nano|*.micro) LOW_MEMORY_FLAG="--low-memory" ;;
  *)              LOW_MEMORY_FLAG="" ;;
esac

# Building on a 1 GB instance is possible with swap and takes twenty-odd
# minutes of a machine that is paging. Building here and shipping the result
# takes the compile off the box entirely, so it is the default at that size --
# --build-on-instance opts back out.
if [ -z "$PREBUILT" ]; then
  case "$INSTANCE_TYPE" in
    *.nano|*.micro) PREBUILT="true" ;;
    *)              PREBUILT="false" ;;
  esac
fi
if [ "$PREBUILT" = "true" ]; then
  PREBUILT_FLAG="--prebuilt"
else
  PREBUILT_FLAG=""
fi

# What the free tier actually covers, stated once so a surprise bill is not the
# way it gets learned:
#
#   * 750 instance-hours/month of t3.micro for 12 months -- one instance running
#     continuously, not two;
#   * 30 GB of EBS general-purpose SSD, which is the whole of VOLUME_GB above,
#     so there is no room for a second volume or for snapshots;
#   * 750 hours/month of in-use public IPv4. The Elastic IP below is free ONLY
#     while attached to a running instance. Stop the instance and keep the
#     address and it starts costing about $3.60/month -- use --destroy, which
#     releases it, rather than stopping the instance to save money.
if [ "$DESTROY" != "true" ]; then
  case "$INSTANCE_TYPE" in
    t3.micro|t2.micro) : ;;
    *) warn "$INSTANCE_TYPE is outside the EC2 free tier (t3.micro/t2.micro)" ;;
  esac
  [ "$VOLUME_GB" -le 30 ] || warn "${VOLUME_GB} GB exceeds the 30 GB EBS free-tier allowance"
fi


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

# --- build locally ----------------------------------------------------------
#
# Deliberately BEFORE anything billable is created. A build that is going to
# fail should fail while the account is still untouched, not after an instance
# and an address are running and waiting on it.
if [ "$PREBUILT" = "true" ]; then
  say "Building images locally"
  bash ops/deploy/build-local.sh --host "$PUBLIC_HOST" --out "$IMAGES_TAR"
  [ -f "$IMAGES_TAR" ] || die "build-local.sh produced no archive at $IMAGES_TAR"
fi

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
  lock_key "$KEY_FILE"
  ok "key pair written to $KEY_FILE"
else
  ok "key pair $KEY_FILE reused"
fi

# --- instance ---------------------------------------------------------------
say "Instance"
ID="$(find_instance)"

if [ -z "$ID" ]; then
  # Canonical publishes the current AMI id as a public SSM parameter, which is
  # the tidy way to ask. But reading it needs ssm:GetParameters, and the policy
  # people actually attach for this -- AmazonEC2FullAccess -- does not grant it.
  # The failure is an AccessDenied on a service the operator never chose to use,
  # thirty seconds into a script that had been working, so fall back rather than
  # make them widen a policy to look up a public value.
  AMI="$($AWS ssm get-parameters \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text 2>/dev/null | grep -v '^None$' || true)"

  if [ -z "$AMI" ]; then
    # ec2:DescribeImages IS in AmazonEC2FullAccess. Owner 099720109477 is
    # Canonical's account id -- filtering by it is what stops this matching
    # somebody else's image that happens to be named like Ubuntu.
    for PATTERN in 'ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*' \
                   'ubuntu/images/hvm-ssd/ubuntu-noble-24.04-amd64-server-*'; do
      AMI="$($AWS ec2 describe-images --owners 099720109477 \
        --filters "Name=name,Values=$PATTERN" \
                  'Name=state,Values=available' \
                  'Name=architecture,Values=x86_64' \
        --query 'sort_by(Images,&CreationDate)[-1].ImageId' \
        --output text 2>/dev/null | grep -v '^None$' || true)"
      [ -n "$AMI" ] && break
    done
    [ -n "$AMI" ] || die "could not find an Ubuntu 24.04 AMI in $REGION"
    ok "AMI $AMI (via describe-images; SSM lookup unavailable)"
  else
    ok "AMI $AMI"
  fi

  # SWAP IS NOT OPTIONAL ON A t3.micro.
  #
  # 1 GB of RAM has to run Postgres, Keycloak, a Node API, nginx and Caddy,
  # whose ceilings total slightly more than the machine. Without swap the
  # overshoot is not an error: the OOM-killer picks a victim by score and a
  # container disappears mid-demo.
  #
  # SWAP_GB defaults to 2, which is sized for RUNNING the stack. That is enough
  # only because images are built locally and shipped -- see --prebuilt. If you
  # pass --build-on-instance, raise it: SWAP_GB=4 covers a compile, and even
  # then the OOM-killer scores sshd as readily as a compiler, so a failure
  # there arrives as a lost connection rather than a build error.
  #
  # Swap on EBS is slow, and that is fine: it exists to absorb peaks that do
  # not coincide, not to be a second tier of RAM. swappiness drops from 60 so
  # the kernel prefers reclaiming page cache to paging out a running container.
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
  - path: /etc/sysctl.d/99-hr-system.conf
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

RESOLVED="$(resolve_a "$PUBLIC_HOST" | tr -d '[:space:]' || true)"
[ "$RESOLVED" = "$EIP" ] || die "$PUBLIC_HOST resolves to '${RESOLVED:-nothing}', expected $EIP"
ok "$PUBLIC_HOST -> $EIP"

# --- ship the code ----------------------------------------------------------
# A function, not a string. SSH_BIN can live under "C:\Program Files", and an
# unquoted $SSH would split that into two words and two confusing errors.
# known_hosts is left at the binary's own default: Windows OpenSSH already keeps
# it in %USERPROFILE%\.ssh, which is the file the operator's other sessions use.
SSH() {
  "$SSH_BIN" -i "$(winpath "$KEY_FILE")" \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=10 \
    "ubuntu@$EIP" "$@"
}

say "Waiting for the instance to accept ssh"
for _ in $(seq 1 60); do
  SSH true 2>/dev/null && break
  sleep 5
done
SSH true 2>/dev/null || die "cannot ssh to $EIP"
SSH 'cloud-init status --wait' >/dev/null 2>&1 || true
ok "instance ready"

say "Copying the application"
if [ -n "$REPO_URL" ]; then
  SSH "test -d hr-system || git clone '$REPO_URL' hr-system; cd hr-system && git pull --ff-only"
else
  # No repo URL: ship the working tree, minus everything that must not travel.
  # .env is excluded deliberately — the demo generates its own secrets.
  #
  # hr-images.tar.gz is excluded because it is uploaded separately below.
  # Without this line the image archive travels TWICE -- once buried in this
  # tarball and once on its own -- which on a home connection is not a
  # rounding error, it is another half-hour.
  tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=.env \
      --exclude=hr-images.tar.gz --exclude=test-results --exclude=playwright-report \
      -czf - . | SSH 'mkdir -p hr-system && tar -xzf - -C hr-system'
fi
ok "code on the instance"

# --- ship the images --------------------------------------------------------
if [ "$PREBUILT" = "true" ]; then
  TAR_MB="$(du -m "$IMAGES_TAR" | cut -f1)"
  say "Uploading images (${TAR_MB} MB)"
  echo "    This is the slow part, and it is silent. On a home connection"
  echo "    budget roughly a minute per 5 MB of upload bandwidth."

  # Streamed through the ssh function rather than scp: it reuses the key, the
  # path conversion and the host, so there is one place where the Windows
  # specifics live. The archive stays on disk either way, so a dropped transfer
  # costs the upload again and not the build.
  SSH 'cat > hr-images.tar.gz' < "$IMAGES_TAR" \
    || die "upload failed — the archive is still at $IMAGES_TAR, re-run to retry"
  ok "archive uploaded"

  say "Loading images on the instance"
  SSH 'gunzip -c hr-images.tar.gz | docker load' \
    || die "docker load failed on the instance"

  # Loaded, and no longer worth the disk on a 30 GB volume.
  SSH 'rm -f hr-images.tar.gz'
  SSH 'docker image ls --format "{{.Repository}}:{{.Tag}}" | grep ^hr-system- | sort'
  ok "images loaded"
fi

# --- install ----------------------------------------------------------------
say "Running the installer"
SSH "cd hr-system && bash ops/deploy/install.sh \
  --host '$PUBLIC_HOST' --mode demo --acme-email '$ACME_EMAIL' \
  --org DEVCORE --org-name 'Devcore Solutions Inc.' \
  --staff-csv '$STAFF_CSV' --hr-admin DEV-023 --seed-demo-users \
  $LOW_MEMORY_FLAG $PREBUILT_FLAG"

say "Demo is up"
cat <<DONE
    https://${PUBLIC_HOST}

    ssh       "$SSH_BIN" -i "$(winpath "$KEY_FILE")" ubuntu@$EIP
    destroy   $0 --destroy

    The demo carries synthetic staff and shared-password logins. Never load
    real employee data into it.
DONE

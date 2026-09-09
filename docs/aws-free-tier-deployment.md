# Deploying the demo to AWS free tier (Sydney, t3.micro)

From a Windows workstation, using Windows OpenSSH.

This is the **hosted demo** path: synthetic staff, shared-password logins, a
public hostname. It runs the same `ops/deploy/install.sh` as an on-prem
install, against the same compose stack, so what the demo proves is what the
customer gets. **Do not put real employee data on it.**

---

## 1. What you need before starting

| | |
|---|---|
| Region | `ap-southeast-2` (Sydney) |
| Instance | `t3.micro` — 2 vCPU, **1 GiB RAM** |
| Volume | 30 GB gp3, encrypted (the entire EBS free-tier allowance) |
| DNS | a hostname you control, pointable at an IP |
| Local tools | AWS CLI v2, Git Bash, Windows OpenSSH |

Check the local tools:

```bash
aws --version && ssh -V && uname -s
```

`ssh -V` must report **OpenSSH_for_Windows**. If it reports anything else the
deploy script finds the Windows binary itself, but your own manual `ssh` calls
will be using Git Bash's copy with a different `known_hosts`. Install the
Windows client from an elevated PowerShell if it is missing:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

---

## 2. IAM

You said you would attach **AmazonEC2FullAccess**. That is enough — but only
because the script was changed to work within it.

**`AmazonEC2FullAccess` does not grant `ssm:GetParameters`.** The tidy way to
find the current Ubuntu AMI is a public SSM parameter Canonical publishes, and
the original script used it. Under this policy that returns `AccessDenied` on a
service you never chose to use, about thirty seconds in. The script now falls
back to `ec2:DescribeImages` filtered to Canonical's owner id, which *is*
covered — so you do not have to widen the policy to look up a public value.

If you would rather grant least privilege than `EC2FullAccess`, the script uses
exactly these actions:

```
ec2:DescribeInstances        ec2:RunInstances           ec2:TerminateInstances
ec2:DescribeImages           ec2:DescribeSecurityGroups ec2:CreateSecurityGroup
ec2:DeleteSecurityGroup      ec2:AuthorizeSecurityGroupIngress
ec2:DescribeAddresses        ec2:AllocateAddress        ec2:AssociateAddress
ec2:ReleaseAddress           ec2:CreateKeyPair          ec2:DeleteKeyPair
ec2:CreateTags               ec2:DescribeInstanceStatus
sts:GetCallerIdentity
```

Configure the CLI:

```bash
aws configure --profile hr-demo
```

Region `ap-southeast-2`, output `json`. Then confirm it works:

```bash
AWS_PROFILE=hr-demo aws sts get-caller-identity
```

---

## 3. The 1 GiB problem, and what was done about it

**This matters more than anything else on the page.** A `t3.micro` has 1 GiB of
RAM. The stack is Postgres, Keycloak (a JVM), a Node API, nginx and Caddy — and
`install.sh` *builds* the API and web images on the instance, which means two
Node compilers. The demo compose overlay budgets 2.75 GB of container ceilings.

Nothing enforces that sum. Left alone the stack starts, reports healthy, and
then the kernel OOM-killer takes whichever container asks for a page at the
wrong moment. It is not a crash you can read: `sshd` scores as eligible as a
compiler, so it usually presents as your deploy losing its connection.

Three changes make `t3.micro` genuinely work:

1. **4 GB of swap**, provisioned by cloud-init before anything else runs, with
   `vm.swappiness=10`. Swap on EBS is slow, and that is fine — it exists to
   absorb peaks that do not coincide, not to be a second tier of RAM.
2. **`docker-compose.micro.yml`**, real ceilings that add up to roughly the
   machine: Postgres 320m (with `shared_buffers` and parallelism tuned down),
   Keycloak 420m with the JVM heap capped at 256m explicitly, API 224m with
   `--max-old-space-size=160`, nginx 32m, Caddy 48m.
3. **A serial image build.** `docker compose build` builds concurrently; on
   this box that is not a slow build, it is a dead one.

`install.sh --low-memory` turns all three on, and `aws-demo.sh` passes it
automatically for any `*.micro` or `*.nano` instance type. It **refuses to
start** if swap is missing, rather than proceeding on an assumption that fails
invisibly later.

**Expect the build to take 15–30 minutes.** That is swap doing its job, not a
hang.

---

## 4. Deploy

```bash
AWS_PROFILE=hr-demo ./ops/deploy/aws-demo.sh \
  --host demo.yourdomain.com \
  --acme-email you@yourdomain.com
```

The script pauses twice, both times waiting on you:

1. **After the Elastic IP is allocated** — it prints the address and waits for
   you to create the `A` record. Let's Encrypt validates over HTTP against that
   name; continuing early means the certificate request fails and Caddy backs
   off. It re-checks resolution before proceeding and refuses if it disagrees.
2. **Never for anything destructive without typing `yes`** — `--destroy`
   confirms explicitly, because it deletes the demo's database with it.

Everything is tagged `Project=hr-system-demo`, which is also how `--destroy`
finds it. Re-running reuses what exists rather than duplicating it.

To tear it down:

```bash
AWS_PROFILE=hr-demo ./ops/deploy/aws-demo.sh --destroy
```

---

## 5. Cost

Within the 12-month free tier, this should be **$0**, on these allowances:

- 750 instance-hours/month of `t3.micro` — one instance running continuously,
  not two;
- 30 GB of EBS general-purpose SSD — the whole of the volume, so there is no
  room for a second volume **or for snapshots**;
- 750 hours/month of in-use public IPv4;
- 100 GB/month data transfer out.

**The one that catches people:** an Elastic IP is free only while attached to a
*running* instance. Stopping the instance to save money and keeping the address
starts costing roughly **$3.60/month**. Use `--destroy`, which releases it.

> **Verify your account's plan before relying on any of this.** AWS replaced the
> 12-month free tier with a credit-based free plan for accounts created after
> mid-2025. If this is a new account, you are likely on the credit model
> instead, where the same usage draws down a credit balance rather than being
> free outright. Check Billing → Free tier in the console; do not assume.

---

## 6. After it is up

```
https://demo.yourdomain.com
```

The demo seeds synthetic staff from `db/seeds/devcore-201.csv` with
`DEV-023` as HR admin, and shared-password logins.

Two things that are **not** proven by a successful demo deploy, and should not
be described to a client as if they were:

- **AD federation has never been tested against a real directory.** Keycloak
  OIDC is wired and works with its own realm; pointing it at a customer's Active
  Directory is untested.
- The demo runs on 1 GiB with swap. It is sized to be *shown*, not to be loaded.
  Do not use its response times as evidence about production sizing.

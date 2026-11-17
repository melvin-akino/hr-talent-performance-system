# AWS Free Tier Multi-Tenant SaaS Deployment & Operations Runbook

## 1. Cloud Architecture Overview

The system is configured as a standalone, multi-tenant SaaS platform optimized for the **AWS 12-Month Free Tier** (or lowest-cost tier indefinitely).

```
 Internet (Users / Admins / Superadmin)
                    │
                    ▼ [Port 80/443]
       ┌───────────────────────────┐
       │     AWS Elastic IP        │
       └────────────┬──────────────┘
                    ▼
       ┌───────────────────────────┐
       │     EC2 t3.micro (1 GiB)  │
       │   [2 GiB EBS Swap Active] │
       │                           │
       │  ┌──────────────────────┐ │
       │  │ Caddy Reverse Proxy  │ │ (Let's Encrypt TLS, HSTS, gzip/zstd)
       │  └──────────┬───────────┘ │
       │      ┌──────┴──────┐      │
       │      ▼             ▼      │
       │  ┌─────────┐   ┌────────┐ │
       │  │  Web    │   │  API   │ │
       │  │ (Nginx) │   │ (Nest) │ │
       │  └─────────┘   └───┬────┘ │
       │                    ▼      │
       │            ┌────────────┐ │
       │            │ PostgreSQL │ │ (PostgreSQL 16 Alpine + RLS Multi-Tenant)
       │            └────────────┘ │
       │                           │
       │  30 GiB Encrypted gp3 EBS │
       └───────────────────────────┘
                    │ (Nightly backup cron)
                    ▼
       ┌───────────────────────────┐
       │    AWS S3 (Free 5 GiB)    │
       └───────────────────────────┘
```

### Free Tier Specifications & Monthly Cost Budget:

| Component | AWS Resource | Free Tier Allowance | Our Usage | Monthly Cost |
| :--- | :--- | :--- | :--- | :--- |
| **Compute** | EC2 `t3.micro` (or `t4g.micro`) | 750 hours/month | 1 instance continuously | **$0.00** |
| **Storage** | EBS gp3 Encrypted | 30 GiB / month | 30 GiB root volume | **$0.00** |
| **Public IPv4** | In-use Elastic IP | 750 hours/month | 1 attached EIP | **$0.00** |
| **TLS Certificate** | Let's Encrypt via Caddy | Free open CA | Auto-renewing TLS | **$0.00** |
| **Offsite Backups** | AWS S3 Standard | 5 GiB storage, 20k GET, 2k PUT | Nightly compressed dumps | **$0.00** |
| **Total Estimated Infrastructure Cost** | | | | **$0.00 / month** |

---

## 2. Memory Budget & Swap Tuning

On a 1 GiB RAM virtual machine, unconstrained Node and JVM processes will trigger the kernel OOM-killer. Under our SaaS architecture:

1. **Native SaaS JWT Auth replaces Keycloak**: Eliminates Java Virtual Machine heap & metaspace overhead (~420 MB saved).
2. **Hard Container Ceilings (`docker-compose.saas.yml`)**:
   - `postgres`: **320 MB** (`shared_buffers=96MB`, `effective_cache_size=256MB`, `max_connections=40`)
   - `api`: **280 MB** (V8 heap bounded to `--max-old-space-size=180`)
   - `web`: **32 MB** (pre-rendered Vite assets on Nginx alpine)
   - `caddy`: **48 MB** (Go binary handling HTTP/2 TLS termination)
   - **Total Container Limit:** **680 MB** (Leaves >340 MB for Linux kernel, systemd, and page cache).
3. **2 GiB EBS Swap Protection**: Configured via `/swapfile` with `vm.swappiness=10`, preventing thrashing while absorbing transient bursts.

---

## 3. Deployment Guide

### Prerequisites
- AWS CLI v2 configured with an IAM user or role holding `AmazonEC2FullAccess`.
- A domain name (e.g. `hr.yourdomain.com`).
- Windows Workstation (PowerShell / Git Bash) or Linux/macOS.

### Step 1: Verify AWS Credentials
```bash
aws sts get-caller-identity
```

### Step 2: Build Images Locally (Low-Memory Workaround)
Building locally avoids compiling TypeScript on a 1 GiB server:
```bash
bash ops/deploy/build-saas.sh --host hr.yourdomain.com
```
*Creates `ops/deploy/hr-saas-images.tar.gz` (~120 MB).*

### Step 3: Run the Cloud Deployment Script
```bash
bash ops/deploy/aws-saas-deploy.sh --host hr.yourdomain.com --acme-email devops@yourdomain.com --region ap-southeast-1
```
The script automatically:
1. Creates the Security Group (opening 80/443 to the web, restricting SSH 22 to your workstation IP).
2. Launches an encrypted 30 GB Ubuntu 24.04 instance with 2 GB swap.
3. Allocates and binds an Elastic IP.
4. Uploads code and Docker images.
5. Generates high-entropy production secrets (`JWT_SECRET`, `SUPERADMIN_SECRET`, database passwords) into `/home/ubuntu/hr-system/.env`.
6. Executes all PostgreSQL migrations `0001` through `0054`.
7. Starts all services via `docker-compose.saas.yml`.

---

## 4. Platform Superadmin Control Plane & Tenant Onboarding

Once live, visit:
`https://hr.yourdomain.com/superadmin/login`

### Generating First Superadmin Account:
SSH into your server:
```bash
ssh -i ~/.ssh/hr-system-saas.pem ubuntu@<ELASTIC_IP>
cd hr-system
```
Retrieve `SUPERADMIN_SECRET` from `.env`:
```bash
grep SUPERADMIN_SECRET .env
```
Run the interactive tenant provisioning CLI or use the REST API:
```bash
curl -X POST https://hr.yourdomain.com/api/superadmin/tenants \
  -H "Authorization: Bearer <SUPERADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "companyName": "Acme Corp Philippines",
    "code": "ACME",
    "adminEmail": "hr@acme.com",
    "adminPassword": "TemporaryPassword123!",
    "adminFirstName": "Maria",
    "adminLastName": "Santos",
    "planTier": "professional",
    "maxEmployees": 100,
    "features": {
      "feature_core_hr": true,
      "feature_performance": true,
      "feature_kpis": true,
      "feature_peer_reviews": true,
      "feature_competencies_pip": true,
      "feature_time_attendance": true,
      "feature_leave_management": true,
      "feature_ph_payroll": true,
      "feature_bank_disbursement": true,
      "feature_bir_statutory_gen": true
    }
  }'
```

---

## 5. Maintenance, Updates & Backups

### Updating Code & Migrations
To push local changes and run new migrations without re-provisioning infrastructure:
```bash
bash ops/deploy/aws-saas-deploy.sh --host hr.yourdomain.com --update-only
```

### Automated Nightly S3 Backups
Set up a cron job on the EC2 host:
```bash
crontab -e
```
Add:
```cron
0 2 * * * S3_BUCKET=my-company-hr-backups /home/ubuntu/hr-system/ops/backup/backup-s3.sh >> /var/log/hr-backup.log 2>&1
```

### Clean Teardown
If the demo or environment needs to be removed cleanly:
```bash
bash ops/deploy/aws-saas-deploy.sh --destroy
```
*Terminates the EC2 instance, releases the Elastic IP, and deletes the security group.*

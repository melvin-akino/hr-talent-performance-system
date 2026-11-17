import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness } from './support/http-harness';
import { hashPassword } from '../src/common/crypto';

describe('SaaS Platform & Superadmin End-to-End Suite', () => {
  let h: Harness;
  let superadminToken: string;
  let createdOrgId: string;
  let tenantAdminToken: string;

  const testSuperadminEmail = `superadmin-${randomUUID().slice(0, 8)}@summitlogic.io`;
  const testSuperadminPass = 'SuperadminSecret123!';

  const clientOrgName = `PH Tech Innovators ${randomUUID().slice(0, 6)}`;
  const clientOrgSlug = `phtech-${randomUUID().slice(0, 6)}`;
  const clientOrgCode = `PHT${Math.floor(100 + Math.random() * 900)}`;
  const clientAdminEmail = `admin-${randomUUID().slice(0, 6)}@phtech.ph`;
  const clientAdminPass = 'ClientSecretPass123!';

  beforeAll(async () => {
    h = await startHarness();

    // Insert a fresh superadmin for this test run
    const hashed = hashPassword(testSuperadminPass);
    await h.admin.query(
      `INSERT INTO app.platform_superadmin (email, password_hash, full_name, is_active)
       VALUES ($1, $2, 'Test Platform Superadmin', TRUE)`,
      [testSuperadminEmail.toLowerCase(), hashed],
    );
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  describe('Superadmin Authentication', () => {
    it('rejects invalid password', async () => {
      const res = await request(h.url)
        .post('/superadmin/auth/login')
        .send({ email: testSuperadminEmail, password: 'WrongPassword' });

      expect(res.status).toBe(401);
    });

    it('authenticates valid superadmin credentials and returns JWT', async () => {
      const res = await request(h.url)
        .post('/superadmin/auth/login')
        .send({ email: testSuperadminEmail, password: testSuperadminPass });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testSuperadminEmail.toLowerCase());

      superadminToken = res.body.token;
    });

    it('denies access to superadmin endpoints without token', async () => {
      const res = await request(h.url).get('/superadmin/tenants');
      expect(res.status).toBe(401);
    });
  });

  describe('Tenant Provisioning & Management', () => {
    it('provisions a new client organization with initial disabled PH payroll', async () => {
      const res = await request(h.url)
        .post('/superadmin/tenants')
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({
          name: clientOrgName,
          code: clientOrgCode,
          slug: clientOrgSlug,
          planTier: 'professional',
          maxEmployees: 150,
          adminFirstName: 'Danilo',
          adminLastName: 'Reyes',
          adminEmail: clientAdminEmail,
          adminPassword: clientAdminPass,
          features: {
            featureCoreHr: true,
            featurePerformance: true,
            featureKpis: true,
            featurePhPayroll: false, // Initially un-licensed
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.organization.name).toBe(clientOrgName);
      expect(res.body.organization.slug).toBe(clientOrgSlug);
      expect(res.body.adminEmployee.email).toBe(clientAdminEmail.toLowerCase());
      expect(res.body.features.feature_ph_payroll).toBe(false);

      createdOrgId = res.body.organization.id;
    });

    it('lists organizations in the superadmin portal', async () => {
      const res = await request(h.url)
        .get('/superadmin/tenants')
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(res.status).toBe(200);
      const found = res.body.find((t: any) => t.id === createdOrgId);
      expect(found).toBeDefined();
      expect(found.name).toBe(clientOrgName);
      expect(found.features.feature_ph_payroll).toBe(false);
    });
  });

  describe('Tenant Client Native Authentication & Graceful Degradation', () => {
    it('authenticates client admin using native email/password credentials', async () => {
      const res = await request(h.url)
        .post('/auth/login')
        .send({ email: clientAdminEmail, password: clientAdminPass });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.employee.firstName).toBe('Danilo');
      expect(res.body.organization.slug).toBe(clientOrgSlug);
      expect(res.body.features.feature_ph_payroll).toBe(false);

      tenantAdminToken = res.body.token;
    });

    it('resolves /employees/me with tenant metadata and features', async () => {
      const res = await request(h.url)
        .get('/employees/me')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.firstName).toBe('Danilo');
      expect(res.body.organization.slug).toBe(clientOrgSlug);
      expect(res.body.features.feature_ph_payroll).toBe(false);
    });
  });

  describe('Feature License Toggling: Philippine Payroll Activation', () => {
    it('activates Philippine Payroll license via Superadmin', async () => {
      const res = await request(h.url)
        .patch(`/superadmin/tenants/${createdOrgId}/features`)
        .set('Authorization', `Bearer ${superadminToken}`)
        .send({ featurePhPayroll: true });

      expect(res.status).toBe(200);
      expect(res.body.feature_ph_payroll).toBe(true);
    });

    it('immediately reflects the activated PH Payroll in tenant context', async () => {
      const res = await request(h.url)
        .get('/employees/me')
        .set('Authorization', `Bearer ${tenantAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.features.feature_ph_payroll).toBe(true);
    });
  });

  describe('Superadmin Impersonation Session', () => {
    it('issues an authorized tenant impersonation session for superadmin auditing', async () => {
      const res = await request(h.url)
        .post(`/superadmin/tenants/${createdOrgId}/impersonate`)
        .set('Authorization', `Bearer ${superadminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.organization.id).toBe(createdOrgId);

      // Verify the impersonated token accesses tenant APIs
      const meRes = await request(h.url)
        .get('/employees/me')
        .set('Authorization', `Bearer ${res.body.token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.organization.id).toBe(createdOrgId);
    });
  });
});

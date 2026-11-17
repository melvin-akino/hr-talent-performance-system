import { Client } from 'pg';
import { hashPassword } from '../common/crypto';

async function main() {
  const connString =
    process.env.ADMIN_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgres://hr_migrator:devmigrator@127.0.0.1:15432/hr';

  const client = new Client({ connectionString: connString });
  await client.connect();

  const email = process.argv[2] || 'superadmin@summitlogic.io';
  const password = process.argv[3] || 'SuperAdminPassword123!';
  const name = process.argv[4] || 'Summit Platform Superadmin';

  console.log(`Seeding superadmin: ${email}...`);
  const hashed = hashPassword(password);

  const res = await client.query(
    `INSERT INTO app.platform_superadmin (email, password_hash, full_name, is_active)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           full_name = EXCLUDED.full_name,
           is_active = TRUE,
           updated_at = now()
     RETURNING id, email, full_name`,
    [email.toLowerCase(), hashed, name],
  );

  console.log('Superadmin ready:', res.rows[0]);
  console.log(`Credentials:`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);

  await client.end();
}

main().catch((err) => {
  console.error('Failed to seed superadmin:', err);
  process.exit(1);
});

/**
 * Creates a Keycloak user for every work email in a staff CSV.
 *
 *   node ops/keycloak/seed-users.mjs db/seeds/devcore-201.csv
 *
 * DEV ONLY. Real deployments federate to Active Directory, where the accounts
 * already exist — this exists so a simulated org can actually be signed into
 * without hand-creating dozens of users in the admin console.
 *
 * The username is the local part of the work email and the email is set
 * verbatim, because first login binds an IdP subject to an employee record by
 * matching on work email. If they disagree, login succeeds and then fails to
 * resolve an employee, which is a confusing way to discover a typo.
 *
 * Idempotent: existing users are left alone.
 */
import { readFileSync } from 'node:fs';

const KC = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM ?? 'hr';
const ADMIN = process.env.KEYCLOAK_ADMIN ?? 'admin';
const ADMIN_PW = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'test1234';

const file = process.argv[2];
if (!file) {
  console.error('usage: node ops/keycloak/seed-users.mjs <staff.csv>');
  process.exit(1);
}

/** Minimal RFC4180 row splitter — the address column contains quoted commas. */
function splitRow(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
const headers = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
const col = (name) => {
  const i = headers.indexOf(name);
  if (i === -1) throw new Error(`column '${name}' not found in ${file}`);
  return i;
};
const [iEmail, iFirst, iLast] = [col('work_email'), col('first_name'), col('last_name')];

const token = await (async () => {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'admin-cli',
      username: ADMIN, password: ADMIN_PW,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak admin login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
})();

const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
let created = 0;
let skipped = 0;

for (const line of lines.slice(1)) {
  const cells = splitRow(line);
  const email = cells[iEmail]?.trim();
  if (!email) continue;
  const username = email.split('@')[0];

  const existing = await fetch(
    `${KC}/admin/realms/${REALM}/users?exact=true&username=${encodeURIComponent(username)}`,
    { headers: auth });
  if ((await existing.json()).length > 0) { skipped++; continue; }

  const res = await fetch(`${KC}/admin/realms/${REALM}/users`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      username, email, enabled: true, emailVerified: true,
      firstName: cells[iFirst]?.trim(), lastName: cells[iLast]?.trim(),
      credentials: [{ type: 'password', value: PASSWORD, temporary: false }],
    }),
  });
  if (!res.ok) {
    console.error(`  ${username}: ${res.status} ${await res.text()}`);
    continue;
  }
  created++;
}

console.log(`Keycloak realm '${REALM}': ${created} user(s) created, ${skipped} already present.`);
console.log(`Password for created users: ${PASSWORD}`);

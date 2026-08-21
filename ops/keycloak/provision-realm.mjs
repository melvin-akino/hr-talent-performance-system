/**
 * Creates (or updates) the HR realm and its SPA client, and optionally wires
 * Active Directory federation.
 *
 *   node ops/keycloak/provision-realm.mjs
 *
 * Idempotent — re-running reconciles the realm, client and LDAP provider to
 * what this file says, so it doubles as the way to change any of them.
 *
 * Run it against Keycloak's INTERNAL address, from inside the compose network:
 *
 *   docker run --rm --network hr-system_default -v "$PWD/ops/keycloak:/s" \
 *     --env-file .env -e KEYCLOAK_URL=http://keycloak:8080/auth \
 *     node:22-alpine node /s/provision-realm.mjs
 *
 * Note the /auth suffix: KC_HTTP_RELATIVE_PATH puts every endpoint under it.
 *
 * Required: KEYCLOAK_ADMIN, KEYCLOAK_ADMIN_PASSWORD, KEYCLOAK_REALM,
 *           OIDC_AUDIENCE, PUBLIC_URL
 * Optional: LDAP_URL and friends (see below). Without them the realm is created
 *           with no users at all, which is correct but not yet sign-in-able.
 */

const need = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`FATAL: ${name} must be set`);
    process.exit(1);
  }
  return v;
};

const KC = (process.env.KEYCLOAK_URL ?? 'http://keycloak:8080/auth').replace(/\/$/, '');
const REALM = need('KEYCLOAK_REALM');
const CLIENT_ID = need('OIDC_AUDIENCE');
const PUBLIC_URL = need('PUBLIC_URL').replace(/\/$/, '');
const ADMIN = need('KEYCLOAK_ADMIN');
const ADMIN_PW = need('KEYCLOAK_ADMIN_PASSWORD');

/**
 * The resource-owner password grant. Off by default: it lets any holder of a
 * username and password mint tokens directly, bypassing the browser flow, MFA
 * and the identity provider. Enable it only to smoke-test a pilot, and turn it
 * back off before staff use the system.
 */
const PASSWORD_GRANT = process.env.KC_ENABLE_PASSWORD_GRANT === 'true';

const token = await (async () => {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'admin-cli',
      username: ADMIN, password: ADMIN_PW,
    }),
  });
  if (!res.ok) {
    throw new Error(`Keycloak admin login failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).access_token;
})();

const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(`${KC}${path}`, {
    method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  if (res.status === 404) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

// --- realm -----------------------------------------------------------------
const realmRep = {
  realm: REALM,
  enabled: true,
  displayName: 'HR System',
  // The LAN is not a trust boundary; Caddy terminates TLS for every request.
  sslRequired: 'all',
  // Accounts come from the directory, not from self-service.
  registrationAllowed: false,
  resetPasswordAllowed: false,
  loginWithEmailAllowed: true,
  // Work email is the join key to the employee record. Two accounts sharing one
  // would make that lookup ambiguous, so the realm must refuse it.
  duplicateEmailsAllowed: false,
  accessTokenLifespan: 300,
  ssoSessionIdleTimeout: 1800,
  bruteForceProtected: true,
};

const existingRealm = await call('GET', `/admin/realms/${REALM}`);
if (existingRealm) {
  await call('PUT', `/admin/realms/${REALM}`, { ...existingRealm, ...realmRep });
  console.log(`Realm '${REALM}' updated`);
} else {
  await call('POST', '/admin/realms', realmRep);
  console.log(`Realm '${REALM}' created`);
}

// --- SPA client ------------------------------------------------------------
const clientRep = {
  clientId: CLIENT_ID,
  name: 'HR System SPA',
  enabled: true,
  protocol: 'openid-connect',
  // A browser app cannot keep a secret, so it is public and secured by PKCE.
  publicClient: true,
  standardFlowEnabled: true,
  implicitFlowEnabled: false,
  directAccessGrantsEnabled: PASSWORD_GRANT,
  serviceAccountsEnabled: false,
  redirectUris: [`${PUBLIC_URL}/*`],
  webOrigins: [PUBLIC_URL],
  attributes: {
    'pkce.code.challenge.method': 'S256',
    'post.logout.redirect.uris': `${PUBLIC_URL}/*`,
  },
  fullScopeAllowed: true,
  description:
    "SPA client. The 'basic' default scope is REQUIRED: since Keycloak 24 it " +
    "carries the 'sub' claim, and the API resolves employees by token subject. " +
    'Dropping it yields tokens with no subject and every request 401s.',
  defaultClientScopes: ['basic', 'acr', 'web-origins', 'profile', 'roles', 'email'],
  protocolMappers: [
    {
      // The API validates the audience. Without this mapper the token's aud is
      // 'account' and every request is rejected as issued for someone else.
      name: `${CLIENT_ID}-audience`,
      protocol: 'openid-connect',
      protocolMapper: 'oidc-audience-mapper',
      consentRequired: false,
      config: {
        'included.client.audience': CLIENT_ID,
        'id.token.claim': 'false',
        'access.token.claim': 'true',
      },
    },
  ],
};

const clients = await call('GET',
  `/admin/realms/${REALM}/clients?clientId=${encodeURIComponent(CLIENT_ID)}`);
if (clients?.length) {
  // Preserve the generated id and any protocol mappers already attached.
  await call('PUT', `/admin/realms/${REALM}/clients/${clients[0].id}`,
    { ...clients[0], ...clientRep, protocolMappers: undefined });
  console.log(`Client '${CLIENT_ID}' updated`);
} else {
  await call('POST', `/admin/realms/${REALM}/clients`, clientRep);
  console.log(`Client '${CLIENT_ID}' created`);
}
console.log(`  redirect URI  ${PUBLIC_URL}/*`);
console.log(`  password grant ${PASSWORD_GRANT ? 'ENABLED — disable before go-live' : 'disabled'}`);

// --- Active Directory federation (optional) --------------------------------
if (!process.env.LDAP_URL) {
  console.log(`\nNo LDAP_URL set — realm has no user federation and therefore no users.`);
  console.log(`Set these and re-run to wire Active Directory:`);
  console.log(`  LDAP_URL             ldaps://dc01.office.local:636`);
  console.log(`  LDAP_BIND_DN         CN=svc-keycloak,OU=Service,DC=office,DC=local`);
  console.log(`  LDAP_BIND_CREDENTIAL <password for that account>`);
  console.log(`  LDAP_USERS_DN        OU=Staff,DC=office,DC=local`);
  console.log(`  LDAP_EMAIL_ATTRIBUTE mail          (optional, defaults to mail)`);
  process.exit(0);
}

const ldapConfig = {
  enabled: ['true'],
  vendor: ['ad'],
  connectionUrl: [need('LDAP_URL')],
  bindDn: [need('LDAP_BIND_DN')],
  bindCredential: [need('LDAP_BIND_CREDENTIAL')],
  usersDn: [need('LDAP_USERS_DN')],
  authType: ['simple'],
  // READ_ONLY: this system is not the system of record for identity. Nobody
  // should be able to change a directory password through the HR app.
  editMode: ['READ_ONLY'],
  importEnabled: ['true'],
  syncRegistrations: ['false'],
  usernameLDAPAttribute: [process.env.LDAP_USERNAME_ATTRIBUTE ?? 'sAMAccountName'],
  rdnLDAPAttribute: ['cn'],
  uuidLDAPAttribute: ['objectGUID'],
  userObjectClasses: ['person, organizationalPerson, user'],
  searchScope: ['2'],
  trustEmail: ['true'],
  pagination: ['true'],
};

const components = await call('GET',
  `/admin/realms/${REALM}/components?type=org.keycloak.storage.UserStorageProvider`);
const existingLdap = components?.find((c) => c.name === 'ad');

const ldapRep = {
  name: 'ad',
  providerId: 'ldap',
  providerType: 'org.keycloak.storage.UserStorageProvider',
  config: ldapConfig,
};

let ldapId;
if (existingLdap) {
  await call('PUT', `/admin/realms/${REALM}/components/${existingLdap.id}`,
    { ...existingLdap, ...ldapRep });
  ldapId = existingLdap.id;
  console.log(`\nLDAP provider updated`);
} else {
  await call('POST', `/admin/realms/${REALM}/components`,
    { ...ldapRep, parentId: REALM });
  const after = await call('GET',
    `/admin/realms/${REALM}/components?type=org.keycloak.storage.UserStorageProvider`);
  ldapId = after.find((c) => c.name === 'ad').id;
  console.log(`\nLDAP provider created`);
}

// The email claim is the join key to the employee record, so which directory
// attribute feeds it is not a detail — it is the whole integration.
const emailAttr = process.env.LDAP_EMAIL_ATTRIBUTE ?? 'mail';
const mappers = await call('GET',
  `/admin/realms/${REALM}/components?parent=${ldapId}&type=org.keycloak.storage.ldap.mappers.LDAPStorageMapper`);
const emailMapper = mappers?.find((m) => m.name === 'email');
const emailRep = {
  name: 'email',
  providerId: 'user-attribute-ldap-mapper',
  providerType: 'org.keycloak.storage.ldap.mappers.LDAPStorageMapper',
  parentId: ldapId,
  config: {
    'user.model.attribute': ['email'],
    'ldap.attribute': [emailAttr],
    'read.only': ['true'],
    'always.read.value.from.ldap': ['true'],
    'is.mandatory.in.ldap': ['true'],
  },
};
if (emailMapper) {
  await call('PUT', `/admin/realms/${REALM}/components/${emailMapper.id}`,
    { ...emailMapper, ...emailRep });
} else {
  await call('POST', `/admin/realms/${REALM}/components`, emailRep);
}
console.log(`  email claim  <- LDAP attribute '${emailAttr}'`);

await call('POST',
  `/admin/realms/${REALM}/user-storage/${ldapId}/sync?action=triggerFullSync`);
console.log(`  full sync triggered`);
console.log(`\nEvery synced user's email must match a Work_Email in the 201 file,`);
console.log(`or their first login authenticates and then resolves no employee.`);

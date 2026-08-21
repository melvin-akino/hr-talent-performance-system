import { z } from 'zod';

/**
 * Centralised, env-validated configuration. Validated once at boot so a missing
 * or malformed variable fails immediately and loudly rather than at 3pm on the
 * first request that happens to need it.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // 'silent' is a real pino level, used to keep test output readable.
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Optional at parse time, required at API boot -- see requireServerConfig().
  // The operator CLI shares this module but needs only ADMIN_DATABASE_URL;
  // forcing an importer to invent an OIDC issuer URL to load a CSV is exactly
  // the kind of friction that gets worked around with a bad shell alias.
  DATABASE_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  /**
   * Privileged (BYPASSRLS) connection used ONLY by the operator CLI for bulk
   * import. Intentionally optional and absent from the API container's
   * environment -- the running API must have no way to reach it.
   */
  ADMIN_DATABASE_URL: z.string().url().optional(),

  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),

  /**
   * Where to FETCH signing keys, when that differs from the issuer's public
   * address. The issuer claim is still asserted against OIDC_ISSUER_URL — this
   * changes only the network path used to retrieve the JWKS.
   *
   * On-prem the two genuinely differ. The issuer must be the public URL, since
   * that is what browsers receive and what the token carries. But the API
   * cannot fetch from it: the public hostname often does not resolve inside the
   * container, and the reverse proxy serves an internally-issued certificate
   * that the container's trust store does not carry. Pointing this at
   * http://keycloak:8080/... keeps key retrieval on the compose network while
   * validation stays strict.
   */
  OIDC_JWKS_URL: z.string().url().optional(),

  /**
   * Office SMTP relay. Optional on purpose: without it notifications still
   * queue durably in the outbox and are delivered once a relay is configured.
   * Refusing to boot would make email a hard dependency of goal-setting.
   */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(25),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Internal relays on port 25 frequently offer no TLS at all. */
  SMTP_IGNORE_TLS: z.coerce.boolean().default(false),
  MAIL_FROM: z.string().default('HR System <no-reply@localhost>'),

  NOTIFY_POLL_MS: z.coerce.number().int().positive().default(15_000),
  NOTIFY_BATCH: z.coerce.number().int().positive().max(500).default(50),
  DIGEST_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  /** Clock skew tolerance for token exp/nbf, in seconds. */
  OIDC_CLOCK_TOLERANCE: z.coerce.number().int().nonnegative().default(30),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Deliberately console + exit rather than throw: this runs before the
    // logger exists, and a stack trace here is noise.
    console.error(`Invalid configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config: Config = load();

/**
 * Variables the HTTP server cannot run without. Called once from bootstrap so
 * the API still fails fast and loudly, while the operator CLI -- which shares
 * this module but serves no requests -- is not held to the same requirements.
 */
export function requireServerConfig(): {
  DATABASE_URL: string;
  OIDC_ISSUER_URL: string;
  OIDC_AUDIENCE: string;
} {
  const missing = (['DATABASE_URL', 'OIDC_ISSUER_URL', 'OIDC_AUDIENCE'] as const).filter(
    (k) => !config[k],
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration for the API server: ${missing.join(', ')}`,
    );
  }
  return {
    DATABASE_URL: config.DATABASE_URL!,
    OIDC_ISSUER_URL: config.OIDC_ISSUER_URL!,
    OIDC_AUDIENCE: config.OIDC_AUDIENCE!,
  };
}

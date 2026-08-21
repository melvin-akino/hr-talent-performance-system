/**
 * Forward-only migration runner.
 *
 * Deliberately minimal and dependency-free. Two properties matter:
 *
 *  1. Each migration runs inside a transaction and is recorded atomically with
 *     its own application. A crash mid-run therefore cannot leave the ledger
 *     disagreeing with the schema.
 *  2. Applied files are checksummed. Editing a migration that has already run
 *     on the production box is a silent-divergence bug that surfaces months
 *     later during a restore -- so it is a hard error here.
 *
 * Runs as hr_migrator (BYPASSRLS, schema owner). Never as the app role.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

/**
 * Walk up from this file until `db/migrations` appears.
 *
 * A fixed `../../../../` is correct for exactly one of the two layouts this
 * code runs in: `apps/api/src/db/` under tsx, but `dist/db/` inside the image,
 * where the build collapses three directories into one. Hardcoding either
 * breaks the other, and the production failure — an empty schema on a
 * healthy-looking cluster — is far more expensive than the dev one.
 */
function findMigrations(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'db/migrations');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate db/migrations searching upward from ${__dirname}`);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Raised when an already-applied migration's contents have changed.
 *
 * A distinct type rather than a bare Error because this is the one failure the
 * caller may legitimately want to identify: it means the working tree and the
 * database disagree about history, which is not something a retry fixes.
 */
export class MigrationChecksumError extends Error {
  constructor(readonly filename: string, readonly applied: string, readonly current: string) {
    super(
      `\n  ${filename} was modified after being applied.\n` +
      `  Applied checksum: ${applied}\n` +
      `  Current checksum: ${current}\n\n` +
      `  Migrations are immutable once applied. Write a new migration\n` +
      `  instead -- editing this one leaves environments silently divergent.\n`,
    );
    this.name = 'MigrationChecksumError';
  }
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

export interface MigrateOptions {
  url: string;
  /** Defaults to the directory located by findMigrations(). */
  dir?: string;
  /** Silenced by tests; the CLI prints progress. */
  log?: (line: string) => void;
}

/**
 * Applies pending migrations, in filename order, and records each one with the
 * checksum of the file that produced it.
 *
 * Throws rather than exiting: exiting the process is a decision for the entry
 * point, and a module that calls process.exit cannot be tested at all.
 */
export async function migrate(opts: MigrateOptions): Promise<MigrateResult> {
  const DIR = opts.dir ?? findMigrations();
  const log = opts.log ?? (() => undefined);
  const client = new Client({ connectionString: opts.url });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER NOT NULL
    )`);

  const applied = new Map<string, string>(
    (await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migration')
    ).rows.map((r) => [r.filename, r.checksum]),
  );

  const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  let alreadyApplied = 0;

  try {
    for (const file of files) {
      const sql = readFileSync(join(DIR, file), 'utf8');
      const checksum = sha256(sql);
      const previous = applied.get(file);

      if (previous) {
        if (previous !== checksum) throw new MigrationChecksumError(file, previous, checksum);
        alreadyApplied++;
        continue;
      }

      log(`applying ${file} ... `);
      const started = Date.now();
      // Each file manages its own BEGIN/COMMIT so a migration can opt out
      // (e.g. CREATE INDEX CONCURRENTLY) if one ever needs to.
      await client.query(sql);
      const duration = Date.now() - started;
      // Recorded only after the file succeeded, so a failed migration is never
      // marked applied and the next run retries it.
      await client.query(
        `INSERT INTO schema_migration (filename, checksum, duration_ms)
         VALUES ($1, $2, $3)`,
        [file, checksum, duration],
      );
      log(`ok (${duration}ms)\n`);
      ran.push(file);
    }
  } finally {
    await client.end();
  }

  log(ran.length === 0 ? 'schema is up to date\n' : `applied ${ran.length} migration(s)\n`);
  return { applied: ran, alreadyApplied };
}

// Entry point. Exit codes belong here, not in the function above.
if (require.main === module) {
  const url = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('ADMIN_DATABASE_URL (or DATABASE_URL) must be set');
    process.exit(1);
  }
  migrate({ url, log: (s) => process.stdout.write(s) }).catch((err: unknown) => {
    console.error(err instanceof MigrationChecksumError ? err.message : err);
    process.exit(1);
  });
}

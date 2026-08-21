import postgres from 'postgres'
import { DDL } from './testing'

/**
 * Apply the schema.
 *
 * The DDL is the same string the test harness runs, so a table that exists in
 * tests exists in production and drift is impossible by construction. Every
 * statement is `IF NOT EXISTS`, which makes this safe to run on every deploy —
 * a migration you are afraid to re-run is a migration nobody runs.
 *
 * **This creates; it does not alter.** Every statement is IF NOT EXISTS, so a
 * renamed or retyped column on an existing table is silently *not* applied —
 * the table already exists, so the statement is skipped and the old column
 * stays. While the schema is still moving and the only rows are demo data,
 * dropping and re-running is the honest answer.
 *
 * The moment a real practice's patients are in here, that stops being true and
 * this has to become a versioned chain. drizzle-kit is already configured for
 * exactly that; `pnpm --filter @vaani/db generate` writes the first migration.
 */

export async function migrate(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error('DATABASE_URL is not set')
  const sql = postgres(url, {
    max: 1,
    ssl: url.includes('sslmode=disable') ? false : 'require',
    onnotice: () => undefined,
  })
  try {
    await sql.unsafe(DDL)
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'
    `
    console.log(`  schema applied — ${rows[0]?.count ?? '?'} tables`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('migration failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from './schema'

/**
 * The database handle.
 *
 * One pool per process. A voice server holds many concurrent calls and each
 * turn does a handful of short queries, so the pool is sized for concurrency of
 * conversations rather than throughput of rows.
 */

export type Database = PostgresJsDatabase<typeof schema>

let cached: { db: Database; close: () => Promise<void> } | null = null

export function connect(url = process.env.DATABASE_URL): { db: Database; close: () => Promise<void> } {
  if (cached) return cached
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The voice server needs a database to resolve tenants and read a diary.',
    )
  }

  const sql = postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 10,
    // Managed Postgres almost always terminates TLS at the proxy with a
    // certificate the client cannot chain. Refusing to connect over that is a
    // false sense of safety on a private network; refusing to *encrypt* would
    // be the real problem, and `require` still encrypts.
    ssl: url.includes('sslmode=disable') ? false : 'require',
    onnotice: () => undefined,
  })

  cached = {
    db: drizzle(sql, { schema }),
    close: async () => {
      cached = null
      await sql.end({ timeout: 5 })
    },
  }
  return cached
}

/** Test seam: hand in a pglite-backed handle instead of opening a socket. */
export function useDatabase(db: Database, close: () => Promise<void> = async () => {}): void {
  cached = { db, close }
}

export function resetDatabase(): void {
  cached = null
}

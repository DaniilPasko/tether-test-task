import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const files = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const existing = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE id = $1',
      [file],
    )
    if ((existing.rowCount ?? 0) > 0) {
      continue
    }

    const sql = await readFile(join(migrationsDir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

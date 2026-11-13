import type { Pool, PoolClient } from 'pg'

export async function touchUser(db: Pool | PoolClient, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO users (id)
     VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
    [userId],
  )
}

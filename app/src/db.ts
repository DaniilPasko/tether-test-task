import type { SQLiteDatabase } from "expo-sqlite";

export const databaseName = "todos.db";

const version = 1;

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync("PRAGMA journal_mode = WAL");
  await db.execAsync("PRAGMA foreign_keys = ON");
  const row = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  if ((row?.user_version ?? 0) >= version) return;
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      CREATE TABLE todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (trim(title) <> ''),
        note TEXT NOT NULL DEFAULT '',
        completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
        created_at TEXT NOT NULL,
        acked_title TEXT,
        acked_note TEXT,
        acked_completed INTEGER,
        CHECK (
          (
            acked_title IS NULL
            AND acked_note IS NULL
            AND acked_completed IS NULL
          )
          OR (
            acked_title IS NOT NULL
            AND acked_note IS NOT NULL
            AND acked_completed IN (0, 1)
            AND trim(acked_title) <> ''
          )
        )
      );

      CREATE TABLE attachments (
        id TEXT PRIMARY KEY,
        todo_id TEXT NOT NULL REFERENCES todos (id) ON DELETE CASCADE,
        filename TEXT NOT NULL CHECK (trim(filename) <> ''),
        mime TEXT NOT NULL CHECK (trim(mime) <> ''),
        local_path TEXT NOT NULL CHECK (trim(local_path) <> ''),
        acked INTEGER NOT NULL DEFAULT 0 CHECK (acked IN (0, 1))
      );

      CREATE INDEX attachments_todo_id_idx ON attachments (todo_id);

      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        todo_id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('save', 'delete')),
        deleted_attachment_ids TEXT NOT NULL DEFAULT '[]'
      );
    `);
    await db.execAsync(`PRAGMA user_version = ${version}`);
  });
}

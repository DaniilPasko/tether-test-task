import type { PoolClient } from "pg";
import { HttpError } from "./http-error.js";
import { maxFiles } from "./limits.js";
import type { StoredFile } from "./storage.js";

export async function replaceAttachments(
  client: PoolClient,
  todoId: string,
  files: StoredFile[],
): Promise<string[]> {
  if (files.length > maxFiles) {
    throw new HttpError(400, "Too many files");
  }
  for (const file of files) {
    await upsertAttachment(client, todoId, file);
  }
  const ids = files.map((file) => file.id);
  const removed =
    ids.length === 0
      ? await client.query<{ storage_path: string }>(
          "DELETE FROM attachments WHERE todo_id = $1 RETURNING storage_path",
          [todoId],
        )
      : await client.query<{ storage_path: string }>(
          `DELETE FROM attachments
           WHERE todo_id = $1 AND id <> ALL($2::uuid[])
           RETURNING storage_path`,
          [todoId, ids],
        );
  return removed.rows.map((row) => row.storage_path);
}

export async function updateAttachments(
  client: PoolClient,
  todoId: string,
  files: StoredFile[],
  deletedIds: string[],
): Promise<string[]> {
  const existing = await client.query<{ id: string }>(
    "SELECT id FROM attachments WHERE todo_id = $1 FOR UPDATE",
    [todoId],
  );
  const existingIds = new Set(existing.rows.map((row) => row.id));
  const removedIds = new Set(deletedIds);
  const added = files.filter((file) => !existingIds.has(file.id)).length;
  const remaining = existing.rows.filter((row) => !removedIds.has(row.id)).length;
  if (remaining + added > maxFiles) {
    throw new HttpError(400, "Too many files");
  }

  for (const file of files) {
    await upsertAttachment(client, todoId, file);
  }
  if (deletedIds.length === 0) {
    return [];
  }
  const removed = await client.query<{ storage_path: string }>(
    `DELETE FROM attachments
     WHERE todo_id = $1 AND id = ANY($2::uuid[])
     RETURNING storage_path`,
    [todoId, deletedIds],
  );
  return removed.rows.map((row) => row.storage_path);
}

async function upsertAttachment(
  client: PoolClient,
  todoId: string,
  file: StoredFile,
): Promise<void> {
  const saved = await client.query(
    `INSERT INTO attachments (id, todo_id, filename, mime, storage_path)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
     SET filename = EXCLUDED.filename,
         mime = EXCLUDED.mime,
         storage_path = EXCLUDED.storage_path
     WHERE attachments.todo_id = EXCLUDED.todo_id
     RETURNING id`,
    [file.id, todoId, file.filename, file.mime, file.relativePath],
  );
  if ((saved.rowCount ?? 0) === 0) {
    throw new HttpError(404, "Attachment not found");
  }
}

import { Directory, File, Paths } from 'expo-file-system'
import type { SQLiteDatabase } from 'expo-sqlite'

const maxFileBytes = 10 * 1024 * 1024
const maxFiles = 5

export type Todo = {
  id: string
  title: string
  note: string
  completed: boolean
  createdAt: string
}

export type TodoAttachment = {
  id: string
  filename: string
  mime: string
  localPath: string
}

export type TodoDetails = Todo & {
  attachments: TodoAttachment[]
}

export type OutboxEntry = {
  todoId: string
  kind: 'save' | 'delete'
}

export type SaveSnapshot = {
  todo: Todo
  acked: {
    title: string
    note: string
    completed: boolean
  } | null
  attachments: Array<TodoAttachment & { acked: boolean }>
  deletedAttachmentIds: string[]
}

export type AcceptedSave = {
  title: string
  note: string
  completed: boolean
  savedAttachmentIds: string[]
  removedAttachmentIds: string[]
}

type TodoRow = {
  id: string
  title: string
  note: string
  completed: number
  created_at: string
  acked_title: string | null
  acked_note: string | null
  acked_completed: number | null
}

const todoSelect = `id, title, note, completed, created_at, acked_title, acked_note, acked_completed`

export async function listTodos(db: SQLiteDatabase): Promise<Todo[]> {
  const rows = await db.getAllAsync<TodoRow>(
    `SELECT ${todoSelect} FROM todos ORDER BY created_at DESC, id DESC`,
  )
  return rows.map(mapTodo)
}

export async function getTodo(db: SQLiteDatabase, id: string): Promise<TodoDetails | null> {
  const row = await db.getFirstAsync<TodoRow>(`SELECT ${todoSelect} FROM todos WHERE id = ?`, id)
  if (!row) return null
  const attachments = await db.getAllAsync<AttachmentRow>(
    `SELECT id, filename, mime, local_path, acked
     FROM attachments
     WHERE todo_id = ?
     ORDER BY rowid`,
    id,
  )
  return {
    ...mapTodo(row),
    attachments: attachments.map(mapAttachment),
  }
}

export async function createTodo(
  db: SQLiteDatabase,
  input: { title: string; note?: string },
): Promise<Todo> {
  const title = requireTitle(input.title)
  const note = (input.note ?? '').trim()
  const todo: Todo = {
    id: crypto.randomUUID(),
    title,
    note,
    completed: false,
    createdAt: new Date().toISOString(),
  }
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO todos (id, title, note, completed, created_at) VALUES (?, ?, ?, 0, ?)`,
      todo.id,
      todo.title,
      todo.note,
      todo.createdAt,
    )
    await retainSave(db, todo.id)
  })
  return todo
}

export async function updateTodo(
  db: SQLiteDatabase,
  id: string,
  patch: { title?: string; note?: string; completed?: boolean },
) {
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<TodoRow>(`SELECT ${todoSelect} FROM todos WHERE id = ?`, id)
    if (!row) throw new Error('Todo not found')
    const title = patch.title === undefined ? row.title : requireTitle(patch.title)
    const note = patch.note === undefined ? row.note : patch.note.trim()
    const completed = patch.completed === undefined ? row.completed : patch.completed ? 1 : 0
    await db.runAsync(
      'UPDATE todos SET title = ?, note = ?, completed = ? WHERE id = ?',
      title,
      note,
      completed,
      id,
    )
    await retainSave(db, id)
  })
}

export async function deleteTodo(db: SQLiteDatabase, id: string) {
  let removed = false
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ acked_title: string | null }>(
      'SELECT acked_title FROM todos WHERE id = ?',
      id,
    )
    if (!row) return
    removed = true
    await db.runAsync('DELETE FROM todos WHERE id = ?', id)
    if (row.acked_title === null) {
      await db.runAsync('DELETE FROM outbox WHERE todo_id = ?', id)
      return
    }
    await db.runAsync(
      `INSERT INTO outbox (todo_id, kind, deleted_attachment_ids) VALUES (?, 'delete', '[]')
       ON CONFLICT (todo_id) DO UPDATE SET kind = 'delete', deleted_attachment_ids = '[]'`,
      id,
    )
  })
  if (removed) removeAttachmentDirectory(id)
}

export async function addAttachment(
  db: SQLiteDatabase,
  todoId: string,
  input: { filename: string; mime: string; localPath: string },
): Promise<TodoAttachment> {
  const filename = requireFilename(input.filename)
  const mime = requireMime(input.mime)
  const todo = await db.getFirstAsync<{ id: string }>('SELECT id FROM todos WHERE id = ?', todoId)
  if (!todo) throw new Error('Todo not found')
  const id = crypto.randomUUID()
  const localPath = storeAttachment(todoId, id, input.localPath)
  try {
    await db.withTransactionAsync(async () => {
      const current = await db.getFirstAsync<{ id: string }>('SELECT id FROM todos WHERE id = ?', todoId)
      if (!current) throw new Error('Todo not found')
      const count = await db.getFirstAsync<{ total: number }>(
        'SELECT COUNT(*) AS total FROM attachments WHERE todo_id = ?',
        todoId,
      )
      if ((count?.total ?? 0) >= maxFiles) throw new Error('Too many files')
      await db.runAsync(
        `INSERT INTO attachments (id, todo_id, filename, mime, local_path) VALUES (?, ?, ?, ?, ?)`,
        id,
        todoId,
        filename,
        mime,
        localPath,
      )
      await retainSave(db, todoId)
    })
  } catch (error) {
    removeFile(localPath)
    throw error
  }
  return { id, filename, mime, localPath }
}

export async function removeAttachment(db: SQLiteDatabase, attachmentId: string) {
  let path: string | null = null
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ todo_id: string; local_path: string; acked: number }>(
      'SELECT todo_id, local_path, acked FROM attachments WHERE id = ?',
      attachmentId,
    )
    if (!row) return
    path = row.local_path
    await db.runAsync('DELETE FROM attachments WHERE id = ?', attachmentId)
    if (row.acked === 1) await rememberDeleted(db, row.todo_id, attachmentId)
    await retainSave(db, row.todo_id)
  })
  if (path) removeFile(path)
}

export async function listOutbox(db: SQLiteDatabase): Promise<OutboxEntry[]> {
  const rows = await db.getAllAsync<{ todo_id: string; kind: 'save' | 'delete' }>(
    'SELECT todo_id, kind FROM outbox ORDER BY id',
  )
  return rows.map((row) => ({ todoId: row.todo_id, kind: row.kind }))
}

export async function readSave(db: SQLiteDatabase, todoId: string): Promise<SaveSnapshot | null> {
  const entry = await db.getFirstAsync<{ kind: string; deleted_attachment_ids: string }>(
    'SELECT kind, deleted_attachment_ids FROM outbox WHERE todo_id = ?',
    todoId,
  )
  if (!entry || entry.kind !== 'save') return null
  const row = await db.getFirstAsync<TodoRow>(`SELECT ${todoSelect} FROM todos WHERE id = ?`, todoId)
  if (!row) return null
  const attachments = await db.getAllAsync<AttachmentRow>(
    `SELECT id, filename, mime, local_path, acked
     FROM attachments
     WHERE todo_id = ?
     ORDER BY rowid`,
    todoId,
  )
  return {
    todo: mapTodo(row),
    acked:
      row.acked_title === null
        ? null
        : {
            title: row.acked_title,
            note: row.acked_note ?? '',
            completed: row.acked_completed === 1,
          },
    attachments: attachments.map((attachment) => ({
      ...mapAttachment(attachment),
      acked: attachment.acked === 1,
    })),
    deletedAttachmentIds: parseIds(entry.deleted_attachment_ids),
  }
}

export async function acknowledgeSave(db: SQLiteDatabase, todoId: string, accepted: AcceptedSave) {
  await db.withTransactionAsync(async () => {
    const todo = await db.getFirstAsync<{ id: string }>('SELECT id FROM todos WHERE id = ?', todoId)
    if (!todo) return
    await db.runAsync(
      'UPDATE todos SET acked_title = ?, acked_note = ?, acked_completed = ? WHERE id = ?',
      accepted.title,
      accepted.note,
      accepted.completed ? 1 : 0,
      todoId,
    )
    if (accepted.savedAttachmentIds.length > 0) {
      const marks = accepted.savedAttachmentIds.map(() => '?').join(', ')
      await db.runAsync(
        `UPDATE attachments SET acked = 1 WHERE todo_id = ? AND id IN (${marks})`,
        todoId,
        ...accepted.savedAttachmentIds,
      )
    }
    const entry = await db.getFirstAsync<{ deleted_attachment_ids: string }>(
      'SELECT deleted_attachment_ids FROM outbox WHERE todo_id = ?',
      todoId,
    )
    if (entry) {
      const removed = new Set(accepted.removedAttachmentIds)
      const remaining = parseIds(entry.deleted_attachment_ids).filter((id) => !removed.has(id))
      await db.runAsync(
        'UPDATE outbox SET deleted_attachment_ids = ? WHERE todo_id = ?',
        JSON.stringify(remaining),
        todoId,
      )
    }
    await retainSave(db, todoId)
  })
}

export async function acknowledgeDelete(db: SQLiteDatabase, todoId: string) {
  await db.runAsync(`DELETE FROM outbox WHERE todo_id = ? AND kind = 'delete'`, todoId)
}

async function retainSave(db: SQLiteDatabase, todoId: string) {
  const todo = await db.getFirstAsync<TodoRow>(`SELECT ${todoSelect} FROM todos WHERE id = ?`, todoId)
  if (!todo) return
  const pending = await db.getFirstAsync<{ total: number }>(
    'SELECT COUNT(*) AS total FROM attachments WHERE todo_id = ? AND acked = 0',
    todoId,
  )
  const entry = await db.getFirstAsync<{ deleted_attachment_ids: string }>(
    'SELECT deleted_attachment_ids FROM outbox WHERE todo_id = ?',
    todoId,
  )
  const dirty =
    todo.acked_title === null ||
    todo.title !== todo.acked_title ||
    todo.note !== todo.acked_note ||
    todo.completed !== todo.acked_completed ||
    (pending?.total ?? 0) > 0 ||
    parseIds(entry?.deleted_attachment_ids).length > 0
  if (!dirty) {
    await db.runAsync('DELETE FROM outbox WHERE todo_id = ?', todoId)
    return
  }
  await db.runAsync(
    `INSERT INTO outbox (todo_id, kind, deleted_attachment_ids) VALUES (?, 'save', '[]')
     ON CONFLICT (todo_id) DO UPDATE SET kind = 'save'`,
    todoId,
  )
}

async function rememberDeleted(db: SQLiteDatabase, todoId: string, attachmentId: string) {
  const entry = await db.getFirstAsync<{ deleted_attachment_ids: string }>(
    'SELECT deleted_attachment_ids FROM outbox WHERE todo_id = ?',
    todoId,
  )
  const ids = parseIds(entry?.deleted_attachment_ids)
  if (!ids.includes(attachmentId)) ids.push(attachmentId)
  const encoded = JSON.stringify(ids)
  if (entry) {
    await db.runAsync(
      `UPDATE outbox SET kind = 'save', deleted_attachment_ids = ? WHERE todo_id = ?`,
      encoded,
      todoId,
    )
    return
  }
  await db.runAsync(
    `INSERT INTO outbox (todo_id, kind, deleted_attachment_ids) VALUES (?, 'save', ?)`,
    todoId,
    encoded,
  )
}

function mapTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    completed: row.completed === 1,
    createdAt: row.created_at,
  }
}

type AttachmentRow = {
  id: string
  filename: string
  mime: string
  local_path: string
  acked: number
}

function mapAttachment(row: AttachmentRow): TodoAttachment {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    localPath: row.local_path,
  }
}

function parseIds(value: string | undefined): string[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is string => typeof item === 'string')
}

function requireTitle(title: string) {
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Title is required')
  return trimmed
}

function requireFilename(filename: string) {
  const name = filename.trim().split(/[/\\]/).pop() ?? ''
  if (!name || name === '.' || name === '..') throw new Error('Filename is required')
  return name
}

function requireMime(mime: string) {
  const trimmed = mime.trim().toLowerCase()
  if (!trimmed || trimmed.startsWith('video/')) throw new Error('This file type is not accepted')
  return trimmed
}

function storeAttachment(todoId: string, attachmentId: string, sourcePath: string) {
  const source = new File(sourcePath)
  if (!source.exists) throw new Error('File is missing')
  if (source.size > maxFileBytes) throw new Error('File is too large')
  const directory = new Directory(Paths.document, 'attachments', todoId)
  directory.create({ intermediates: true, idempotent: true })
  const destination = new File(directory, attachmentId)
  source.copySync(destination)
  return destination.uri
}

function removeFile(path: string) {
  const file = new File(path)
  if (file.exists) file.delete()
}

function removeAttachmentDirectory(todoId: string) {
  const directory = new Directory(Paths.document, 'attachments', todoId)
  if (directory.exists) directory.delete()
}

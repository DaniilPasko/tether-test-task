import { basename } from 'node:path'
import type { Readable } from 'node:stream'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import type { PoolClient } from 'pg'
import { replaceAttachments, updateAttachments } from './attachments.js'
import { pool } from './db.js'
import { HttpError } from './http-error.js'
import {
  discardPartial,
  publishFiles,
  removeStored,
  removeTodoFiles,
  writePartial,
  type StoredFile,
} from './storage.js'
import { touchUser } from './users.js'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type TodoFields = {
  title?: string
  note?: string
  completed?: boolean
  createdAt?: Date
}

type TodoForm = {
  fields: TodoFields
  files: StoredFile[]
  deletedIds: string[]
}

export const todoRoutes: FastifyPluginAsync = async (app) => {
  app.post('/todos/:id', async (request, reply) => {
    const id = readTodoId(request)
    const userId = readUserId(request)
    await touchUser(pool, userId)
    const form = await readForm(request, userId, id)
    const title = requireTitle(form.fields.title)
    const createdAt = requireCreatedAt(form.fields.createdAt)
    const note = form.fields.note ?? ''
    const completed = form.fields.completed ?? false

    let removed: string[] = []
    let committed = false
    try {
      const status = await withTransaction(async (client) => {
        const owner = await lockTodo(client, id)
        if (!owner) {
          await client.query(
            `INSERT INTO todos (id, user_id, title, note, completed, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, userId, title, note, completed, createdAt],
          )
          removed = await replaceAttachments(client, id, form.files)
          return 201
        }
        if (owner !== userId) {
          throw new HttpError(404, 'Todo not found')
        }
        await client.query(
          `UPDATE todos
           SET title = $3, note = $4, completed = $5, created_at = $6
           WHERE id = $1 AND user_id = $2`,
          [id, userId, title, note, completed, createdAt],
        )
        removed = await replaceAttachments(client, id, form.files)
        return 200
      })
      committed = true
      await publishFiles(form.files)
      await removeStored(removed)
      return reply.code(status).send()
    } catch (error) {
      if (!committed) {
        await discardPartial(form.files)
      }
      throw error
    }
  })

  app.put('/todos/:id', async (request, reply) => {
    const id = readTodoId(request)
    const userId = readUserId(request)
    await touchUser(pool, userId)
    const form = await readForm(request, userId, id)
    if (form.fields.createdAt) {
      await discardPartial(form.files)
      throw new HttpError(400, 'CreatedAt cannot be changed')
    }

    let removed: string[] = []
    let committed = false
    try {
      await withTransaction(async (client) => {
        const owner = await lockTodo(client, id)
        if (owner !== userId) {
          throw new HttpError(404, 'Todo not found')
        }

        const sets: string[] = []
        const values: unknown[] = [id, userId]
        if (form.fields.title !== undefined) {
          values.push(requireTitle(form.fields.title))
          sets.push(`title = $${values.length}`)
        }
        if (form.fields.note !== undefined) {
          values.push(form.fields.note)
          sets.push(`note = $${values.length}`)
        }
        if (form.fields.completed !== undefined) {
          values.push(form.fields.completed)
          sets.push(`completed = $${values.length}`)
        }
        if (sets.length > 0) {
          await client.query(
            `UPDATE todos SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2`,
            values,
          )
        }
        removed = await updateAttachments(client, id, form.files, form.deletedIds)
      })
      committed = true
      await publishFiles(form.files)
      await removeStored(removed)
      return reply.code(204).send()
    } catch (error) {
      if (!committed) {
        await discardPartial(form.files)
      }
      throw error
    }
  })

  app.delete('/todos/:id', async (request, reply) => {
    const id = readTodoId(request)
    const userId = readUserId(request)
    await touchUser(pool, userId)

    await withTransaction(async (client) => {
      const deleted = await client.query(
        'DELETE FROM todos WHERE id = $1 AND user_id = $2',
        [id, userId],
      )
      if ((deleted.rowCount ?? 0) > 0) {
        return
      }
      const owner = await lockTodo(client, id)
      if (owner) {
        throw new HttpError(404, 'Todo not found')
      }
    })

    await removeTodoFiles(userId, id)
    return reply.code(204).send()
  })
}

function readUuid(value: string, message: string): string {
  if (!uuidPattern.test(value)) {
    throw new HttpError(400, message)
  }
  return value.toLowerCase()
}

function readUserId(request: FastifyRequest): string {
  const header = request.headers['x-installation-id']
  if (typeof header !== 'string' || !uuidPattern.test(header)) {
    throw new HttpError(401, 'X-Installation-Id is required')
  }
  return header.toLowerCase()
}

function readTodoId(request: FastifyRequest): string {
  const id = request.params
  if (typeof id !== 'object' || id === null || !('id' in id) || typeof id.id !== 'string' || !uuidPattern.test(id.id)) {
    throw new HttpError(400, 'Todo id must be a uuid')
  }
  return id.id.toLowerCase()
}

async function readForm(
  request: FastifyRequest,
  userId: string,
  todoId: string,
): Promise<TodoForm> {
  if (!request.isMultipart()) {
    throw new HttpError(415, 'Content-Type must be multipart/form-data')
  }

  const fields: TodoFields = {}
  const files: StoredFile[] = []
  const deletedIds: string[] = []

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        files.push(
          await readFilePart(
            userId,
            todoId,
            part.fieldname,
            part.filename,
            part.mimetype,
            part.file as Readable,
          ),
        )
        continue
      }
      if (typeof part.value !== 'string') {
        throw new HttpError(400, 'Field values must be text')
      }
      if (part.fieldname === 'deletedAttachmentIds') {
        const id = readUuid(part.value, 'Attachment id must be a uuid')
        if (deletedIds.includes(id)) {
          throw new HttpError(400, 'Duplicate field')
        }
        deletedIds.push(id)
        continue
      }
      assignField(fields, part.fieldname, part.value)
    }
    for (const file of files) {
      if (deletedIds.includes(file.id)) {
        throw new HttpError(400, 'Attachment cannot be saved and deleted')
      }
    }
    return { fields, files, deletedIds }
  } catch (error) {
    await discardPartial(files)
    throw error
  }
}

async function readFilePart(
  userId: string,
  todoId: string,
  fieldname: string,
  rawFilename: string,
  mime: string,
  body: Readable,
): Promise<StoredFile> {
  if (!uuidPattern.test(fieldname)) {
    body.resume()
    throw new HttpError(400, 'Attachment id must be a uuid')
  }
  const filename = basename(rawFilename).trim()
  if (!filename || filename === '.' || filename === '..') {
    body.resume()
    throw new HttpError(400, 'Filename is required')
  }
  if (!mime || mime.startsWith('video/')) {
    body.resume()
    throw new HttpError(400, 'This file type is not accepted')
  }
  return writePartial(userId, todoId, {
    id: fieldname.toLowerCase(),
    filename,
    mime,
    body,
  })
}

function assignField(fields: TodoFields, name: string, value: string): void {
  if (name === 'title') {
    if (fields.title !== undefined) {
      throw new HttpError(400, 'Duplicate field')
    }
    fields.title = value.trim()
    return
  }
  if (name === 'note') {
    if (fields.note !== undefined) {
      throw new HttpError(400, 'Duplicate field')
    }
    fields.note = value.trim()
    return
  }
  if (name === 'completed') {
    if (fields.completed !== undefined) {
      throw new HttpError(400, 'Duplicate field')
    }
    if (value !== 'true' && value !== 'false') {
      throw new HttpError(400, 'Completed must be true or false')
    }
    fields.completed = value === 'true'
    return
  }
  if (name === 'createdAt') {
    if (fields.createdAt !== undefined) {
      throw new HttpError(400, 'Duplicate field')
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
      throw new HttpError(400, 'CreatedAt must be an ISO timestamp')
    }
    const createdAt = new Date(value)
    if (Number.isNaN(createdAt.getTime())) {
      throw new HttpError(400, 'CreatedAt must be an ISO timestamp')
    }
    fields.createdAt = createdAt
    return
  }
  throw new HttpError(400, 'Unexpected field')
}

function requireTitle(title: string | undefined): string {
  if (!title) {
    throw new HttpError(400, 'Title is required')
  }
  return title
}

function requireCreatedAt(createdAt: Date | undefined): Date {
  if (!createdAt) {
    throw new HttpError(400, 'CreatedAt is required')
  }
  return createdAt
}

async function lockTodo(client: PoolClient, id: string): Promise<string | undefined> {
  const found = await client.query<{ user_id: string }>(
    'SELECT user_id FROM todos WHERE id = $1 FOR UPDATE',
    [id],
  )
  return found.rows[0]?.user_id
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

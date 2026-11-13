import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { config } from './config.js'
import { HttpError } from './http-error.js'

export type StoredFile = {
  id: string
  filename: string
  mime: string
  relativePath: string
  partialPath: string
}

export async function writePartial(
  userId: string,
  todoId: string,
  file: { id: string; filename: string; mime: string; body: Readable },
): Promise<StoredFile> {
  const relativePath = `${userId}/${todoId}/${file.id}`
  const finalPath = insideUploadDir(relativePath)
  const partialPath = `${finalPath}.partial`
  await mkdir(resolve(config.uploadDir, userId, todoId), { recursive: true })
  try {
    await pipeline(file.body, createWriteStream(partialPath))
  } catch (error) {
    await rm(partialPath, { force: true })
    throw error
  }
  return {
    id: file.id,
    filename: file.filename,
    mime: file.mime,
    relativePath,
    partialPath,
  }
}

export async function publishFiles(files: StoredFile[]): Promise<void> {
  for (const file of files) {
    await rename(file.partialPath, insideUploadDir(file.relativePath))
  }
}

export async function discardPartial(files: StoredFile[]): Promise<void> {
  await Promise.all(files.map((file) => rm(file.partialPath, { force: true })))
}

export async function removeStored(relativePaths: string[]): Promise<void> {
  await Promise.all(
    relativePaths.map((relativePath) => rm(insideUploadDir(relativePath), { force: true })),
  )
}

export async function removeTodoFiles(userId: string, todoId: string): Promise<void> {
  await rm(insideUploadDir(`${userId}/${todoId}`), { recursive: true, force: true })
}

function insideUploadDir(relativePath: string): string {
  const root = resolve(config.uploadDir)
  const path = resolve(root, relativePath)
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new HttpError(400, 'Invalid path')
  }
  return path
}

import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { todoRoutes } from './todos.js'

const maxFileBytes = 10 * 1024 * 1024
const maxFiles = 5

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: true,
    bodyLimit: maxFileBytes * maxFiles + 1024 * 1024,
  })

  app.register(multipart, {
    throwFileSizeLimit: true,
    limits: {
      fileSize: maxFileBytes,
      files: maxFiles,
    },
  })

  app.get('/health', async () => {
    return { ok: true }
  })

  app.register(todoRoutes)

  return app
}

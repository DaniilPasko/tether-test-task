import { mkdir } from 'node:fs/promises'
import { buildApp } from './app.js'
import { config } from './config.js'

const app = buildApp()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
}

try {
  await mkdir(config.uploadDir, { recursive: true })
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

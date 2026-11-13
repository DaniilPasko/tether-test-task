import { mkdir } from "node:fs/promises";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { migrate } from "./migrate.js";

const app = buildApp();

const shutdown = () => {
  app
    .close()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, shutdown);
}

try {
  await mkdir(config.uploadDir, { recursive: true });
  await migrate(pool);
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await pool.end();
  process.exit(1);
}

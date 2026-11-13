function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readPort(): number {
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function readDatabaseUrl(): string {
  const databaseUrl = required("DATABASE_URL");
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres protocol");
  }
  return databaseUrl;
}

export const config = {
  port: readPort(),
  databaseUrl: readDatabaseUrl(),
  uploadDir: required("UPLOAD_DIR"),
};

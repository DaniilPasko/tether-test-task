import { randomUUID } from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { createContext, useContext, useState, type ReactNode } from "react";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const installationFile = new File(Paths.document, "installation-id");

let cached: string | null = null;

export function readInstallationId(): string {
  if (cached) return cached;
  if (installationFile.exists) {
    const stored = installationFile.textSync().trim().toLowerCase();
    if (uuidPattern.test(stored)) {
      cached = stored;
      return stored;
    }
    installationFile.delete();
  }
  const id = randomUUID();
  installationFile.create();
  installationFile.writeSync(id);
  cached = id;
  return id;
}

const InstallationContext = createContext<string | null>(null);

export function InstallationProvider({ children }: { children: ReactNode }) {
  const [id] = useState(() => readInstallationId());
  return <InstallationContext value={id}>{children}</InstallationContext>;
}

export function useInstallationId() {
  const id = useContext(InstallationContext);
  if (!id) throw new Error("Installation id is missing");
  return id;
}

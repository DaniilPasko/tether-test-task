import NetInfo from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";
import axios, { type AxiosInstance } from "axios";
import Constants from "expo-constants";
import type { SQLiteDatabase } from "expo-sqlite";
import { Platform } from "react-native";
import { readInstallationId } from "./installation";
import {
  acknowledgeDelete,
  acknowledgeSave,
  listOutbox,
  queueDelete,
  readSave,
  type SaveSnapshot,
} from "./todos";

export type SyncStatus = "offline" | "syncing" | "synced" | "out-of-sync";

export type SyncSnapshot = {
  status: SyncStatus;
  toggleOn: boolean;
  toggleEnabled: boolean;
};

let client: AxiosInstance | null = null;
let database: SQLiteDatabase | null = null;
let running: Promise<void> | null = null;
let again = false;
let blocked = false;
let netOnline = true;
let manualOnline = true;
let snapshot: SyncSnapshot = {
  status: "synced",
  toggleOn: true,
  toggleEnabled: true,
};
const listeners = new Set<() => void>();

export function watchNetwork(db: SQLiteDatabase) {
  database = db;
  onlineManager.setEventListener(() =>
    NetInfo.addEventListener((state) => {
      if (typeof state.isConnected !== "boolean") return;
      setNetConnected(state.isConnected);
    }),
  );
  return () => {
    onlineManager.setEventListener(() => undefined);
  };
}

export function setManualOnline(on: boolean) {
  if (!netOnline) return;
  manualOnline = on;
  applyOnline(netOnline && manualOnline);
}

export function retrySync() {
  if (!database || !onlineManager.isOnline() || running) return;
  blocked = false;
  pushTodoChanges(database);
}

export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncSnapshot() {
  return snapshot;
}

export function pushTodoChanges(db: SQLiteDatabase) {
  database = db;
  if (!onlineManager.isOnline() || blocked) return;
  again = true;
  if (running) return;
  const installationId = readInstallationId();
  running = drain(db, installationId).finally(() => {
    running = null;
    publish();
  });
  publish();
}

async function drain(db: SQLiteDatabase, installationId: string) {
  try {
    while (again && !blocked && onlineManager.isOnline()) {
      again = false;
      const queue = await listOutbox(db);
      for (const entry of queue) {
        if (blocked || !onlineManager.isOnline()) return;
        try {
          await sendEntry(db, installationId, entry.todoId);
        } catch (error) {
          if (!onlineManager.isOnline() || axios.isCancel(error)) return;
          blocked = true;
          return;
        }
      }
    }
  } catch (error) {
    if (!onlineManager.isOnline() || axios.isCancel(error)) return;
    blocked = true;
  }
}

function setNetConnected(connected: boolean) {
  const wasConnected = netOnline;
  netOnline = connected;
  if (!connected) manualOnline = false;
  else if (!wasConnected) manualOnline = true;
  applyOnline(netOnline && manualOnline);
}

function applyOnline(next: boolean) {
  const previous = onlineManager.isOnline();
  onlineManager.setOnline(next);
  if (!previous && next && database) {
    blocked = false;
    pushTodoChanges(database);
  }
  publish();
}

function publish() {
  const next: SyncSnapshot = {
    status: currentStatus(),
    toggleOn: manualOnline,
    toggleEnabled: netOnline,
  };
  if (
    snapshot.status === next.status &&
    snapshot.toggleOn === next.toggleOn &&
    snapshot.toggleEnabled === next.toggleEnabled
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

function currentStatus(): SyncStatus {
  if (!onlineManager.isOnline()) return "offline";
  if (running) return "syncing";
  if (blocked) return "out-of-sync";
  return "synced";
}

async function sendEntry(db: SQLiteDatabase, installationId: string, todoId: string) {
  const snapshot = await readSave(db, todoId);
  if (snapshot) {
    await sendSave(db, installationId, snapshot);
    return;
  }
  const queued = await db.getFirstAsync<{ kind: string }>(
    "SELECT kind FROM outbox WHERE todo_id = ?",
    todoId,
  );
  if (queued?.kind !== "delete") return;
  await http().delete(`/todos/${todoId}`, { headers: headers(installationId) });
  await acknowledgeDelete(db, todoId);
}

async function sendSave(db: SQLiteDatabase, installationId: string, snapshot: SaveSnapshot) {
  const fields = changedFields(snapshot);
  const files = pendingFiles(snapshot);
  if (!fields && files.uploads.length === 0 && files.removed.length === 0) return;
  const body = new FormData();
  if (fields) {
    for (const [name, value] of Object.entries(fields)) body.append(name, value);
  }
  for (const file of files.uploads) {
    body.append(file.id, {
      uri: file.localPath,
      name: file.filename,
      type: file.mime,
    } as unknown as Blob);
  }
  for (const id of files.removed) body.append("deletedAttachmentIds", id);
  const url = `/todos/${snapshot.todo.id}`;
  const requestHeaders = headers(installationId);
  if (snapshot.acked) {
    await http().put(url, body, { headers: requestHeaders });
  } else {
    await http().post(url, body, { headers: requestHeaders });
  }
  const applied = await acknowledgeSave(db, snapshot.todo.id, {
    title: snapshot.todo.title,
    note: snapshot.todo.note,
    completed: snapshot.todo.completed,
    savedAttachmentIds: files.uploads.map((file) => file.id),
    removedAttachmentIds: files.removed,
  });
  if (applied) return;
  await queueDelete(db, snapshot.todo.id);
  await http().delete(url, { headers: requestHeaders });
  await acknowledgeDelete(db, snapshot.todo.id);
}

function pendingFiles(snapshot: SaveSnapshot) {
  const removedIds = snapshot.acked ? snapshot.deletedAttachmentIds : [];
  const removed = new Set(removedIds);
  const uploads = snapshot.attachments.filter((file) => {
    if (removed.has(file.id)) return false;
    return snapshot.acked ? !file.acked : true;
  });
  return { uploads, removed: removedIds.filter((id) => !uploads.some((file) => file.id === id)) };
}

function changedFields(snapshot: SaveSnapshot): Record<string, string> | null {
  const { todo, acked } = snapshot;
  if (!acked) {
    return {
      title: todo.title,
      note: todo.note,
      completed: todo.completed ? "true" : "false",
      createdAt: todo.createdAt,
    };
  }
  const fields: Record<string, string> = {};
  if (todo.title !== acked.title) fields.title = todo.title;
  if (todo.note !== acked.note) fields.note = todo.note;
  if (todo.completed !== acked.completed) fields.completed = todo.completed ? "true" : "false";
  if (Object.keys(fields).length === 0) return null;
  return fields;
}

function headers(installationId: string) {
  return { "X-Installation-Id": installationId };
}

function http() {
  if (!client) {
    client = axios.create({
      baseURL: `http://${apiHost()}:3000`,
      timeout: 10000,
    });
    client.interceptors.request.use((config) => {
      if (!onlineManager.isOnline()) throw new axios.CanceledError();
      return config;
    });
  }
  return client;
}

function apiHost() {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  if (host && !(Platform.OS === "android" && (host === "localhost" || host === "127.0.0.1"))) {
    return host;
  }
  return Platform.OS === "android" ? "10.0.2.2" : "localhost";
}

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
  retainSave,
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
let active = false;
let again = false;
let blocked = false;
let netOnline = true;
let netKnown = false;
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
  const next = netOnline && manualOnline;
  applyOnline(next, next && !onlineManager.isOnline());
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
}

async function drain(db: SQLiteDatabase, installationId: string) {
  try {
    while (again && !blocked && onlineManager.isOnline()) {
      again = false;
      const queue = await listOutbox(db);
      if (queue.length === 0) continue;
      active = true;
      publish();
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
  } finally {
    active = false;
  }
}

function setNetConnected(connected: boolean) {
  const wasConnected = netKnown && netOnline;
  netKnown = true;
  netOnline = connected;
  if (!connected) manualOnline = false;
  else if (!wasConnected) manualOnline = true;
  const next = netOnline && manualOnline;
  applyOnline(next, next && !wasConnected);
}

function applyOnline(next: boolean, flush: boolean) {
  onlineManager.setOnline(next);
  if (flush && database) {
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
  if (active) return "syncing";
  if (blocked) return "out-of-sync";
  return "synced";
}

async function sendEntry(db: SQLiteDatabase, installationId: string, todoId: string) {
  const save = await readSave(db, todoId);
  if (save) {
    await sendSave(db, installationId, save);
    return;
  }
  const queued = await db.getFirstAsync<{ kind: string }>(
    "SELECT kind FROM outbox WHERE todo_id = ?",
    todoId,
  );
  if (queued?.kind !== "delete") {
    await db.runAsync("DELETE FROM outbox WHERE todo_id = ? AND kind = 'save'", todoId);
    return;
  }
  await http().delete(`/todos/${todoId}`, { headers: headers(installationId) });
  await acknowledgeDelete(db, todoId);
}

async function sendSave(db: SQLiteDatabase, installationId: string, save: SaveSnapshot) {
  const fields = changedFields(save);
  const files = pendingFiles(save);
  if (!fields && files.uploads.length === 0 && files.removed.length === 0) {
    await retainSave(db, save.todo.id);
    return;
  }
  const url = `/todos/${save.todo.id}`;
  const requestHeaders = headers(installationId);
  if (save.acked) {
    try {
      await http().put(url, saveBody(fields, files), { headers: requestHeaders });
    } catch (error) {
      if (!isMissing(error)) throw error;
      await sendCreate(db, url, requestHeaders, save);
      return;
    }
  } else {
    await http().post(url, saveBody(fields, files), { headers: requestHeaders });
  }
  await finishSave(db, url, requestHeaders, save, files);
}

async function sendCreate(
  db: SQLiteDatabase,
  url: string,
  requestHeaders: Record<string, string>,
  save: SaveSnapshot,
) {
  await http().post(
    url,
    saveBody(
      {
        title: save.todo.title,
        note: save.todo.note,
        completed: save.todo.completed ? "true" : "false",
        createdAt: save.todo.createdAt,
      },
      { uploads: save.attachments, removed: [] },
    ),
    { headers: requestHeaders },
  );
  await finishSave(db, url, requestHeaders, save, {
    uploads: save.attachments,
    removed: save.deletedAttachmentIds,
  });
}

async function finishSave(
  db: SQLiteDatabase,
  url: string,
  requestHeaders: Record<string, string>,
  save: SaveSnapshot,
  files: { uploads: { id: string }[]; removed: string[] },
) {
  const applied = await acknowledgeSave(db, save.todo.id, {
    title: save.todo.title,
    note: save.todo.note,
    completed: save.todo.completed,
    savedAttachmentIds: files.uploads.map((file) => file.id),
    removedAttachmentIds: files.removed,
  });
  if (applied) return;
  await queueDelete(db, save.todo.id);
  await http().delete(url, { headers: requestHeaders });
  await acknowledgeDelete(db, save.todo.id);
}

function saveBody(
  fields: Record<string, string> | null,
  files: { uploads: SaveSnapshot["attachments"]; removed: string[] },
) {
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
  return body;
}

function isMissing(error: unknown) {
  return axios.isAxiosError(error) && error.response?.status === 404;
}

function pendingFiles(save: SaveSnapshot) {
  const removedIds = save.acked ? save.deletedAttachmentIds : [];
  const removed = new Set(removedIds);
  const uploads = save.attachments.filter((file) => {
    if (removed.has(file.id)) return false;
    return save.acked ? !file.acked : true;
  });
  return { uploads, removed: removedIds.filter((id) => !uploads.some((file) => file.id === id)) };
}

function changedFields(save: SaveSnapshot): Record<string, string> | null {
  const { todo, acked } = save;
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

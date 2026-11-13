import { Ionicons } from "@expo/vector-icons";
import { randomUUID } from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Stack, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { pushTodoChanges } from "./sync";
import { SyncBar } from "./sync-bar";
import { colors, stackOptions } from "./theme";
import {
  addAttachment,
  createTodo,
  getTodo,
  maxFileBytes,
  maxFiles,
  removeAttachment,
  updateTodo,
} from "./todos";

type DraftAttachment = {
  id: string;
  filename: string;
  mime: string;
  localPath: string;
  persisted: boolean;
};

type PickedFile = {
  filename: string;
  mime: string;
  localPath: string;
  size?: number;
};

export default function Editor({ todoId }: { todoId?: string }) {
  const db = useSQLiteContext();
  const router = useRouter();
  const [ready, setReady] = useState(!todoId);
  const [titleText, setTitleText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [files, setFiles] = useState<DraftAttachment[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [recordId, setRecordId] = useState(todoId ?? null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const routerRef = useRef(router);
  routerRef.current = router;
  const full = files.length >= maxFiles;
  const canSave = titleText.trim().length > 0 && ready && !saving;

  useEffect(() => {
    if (!todoId) return;
    let active = true;
    getTodo(db, todoId).then((todo) => {
      if (!active) return;
      if (!todo) {
        routerRef.current.back();
        return;
      }
      setTitleText(todo.title);
      setNoteText(todo.note);
      setFiles(
        todo.attachments.map((file) => ({
          id: file.id,
          filename: file.filename,
          mime: file.mime,
          localPath: file.localPath,
          persisted: true,
        })),
      );
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [db, todoId]);

  function addFile(file: PickedFile) {
    try {
      assertAttachment(files.length, file);
    } catch (error) {
      alertError(error);
      return;
    }
    const filename = file.filename.trim().split(/[/\\]/).pop() ?? "";
    setFiles((current) => [
      ...current,
      {
        id: randomUUID(),
        filename,
        mime: file.mime.trim().toLowerCase(),
        localPath: file.localPath,
        persisted: false,
      },
    ]);
  }

  function removeFile(id: string) {
    const file = files.find((item) => item.id === id);
    if (file?.persisted) {
      setRemoved((ids) => (ids.includes(id) ? ids : [...ids, id]));
    }
    setFiles((current) => current.filter((item) => item.id !== id));
  }

  async function takePhoto() {
    if (full) {
      Alert.alert("Too many files");
      return;
    }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Camera access is needed to take a photo");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: "images" });
    if (result.canceled) return;
    addImage(result.assets[0]);
  }

  async function pickPhoto() {
    if (full) {
      Alert.alert("Too many files");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images" });
    if (result.canceled) return;
    addImage(result.assets[0]);
  }

  async function pickDocument() {
    if (full) {
      Alert.alert("Too many files");
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    addFile({
      filename: asset.name,
      mime: asset.mimeType ?? mimeFromName(asset.name),
      localPath: asset.uri,
      size: asset.size,
    });
  }

  function addImage(asset: ImagePicker.ImagePickerAsset) {
    const filename = asset.fileName?.trim() || nameFromUri(asset.uri, "photo.jpg");
    addFile({
      filename,
      mime: asset.mimeType?.trim() || mimeFromName(filename),
      localPath: asset.uri,
      size: asset.fileSize,
    });
  }

  async function save() {
    if (savingRef.current) return;
    const title = titleText.trim();
    if (!title || !ready) return;
    savingRef.current = true;
    setSaving(true);
    let written = false;
    try {
      let id = recordId;
      if (!id) {
        const todo = await createTodo(db, { title, note: noteText });
        id = todo.id;
        setRecordId(id);
      } else {
        await updateTodo(db, id, { title, note: noteText });
      }
      written = true;
      for (const attachmentId of removed) {
        await removeAttachment(db, attachmentId);
      }
      setRemoved([]);
      for (const file of files) {
        if (file.persisted) continue;
        const stored = await addAttachment(db, id, {
          id: file.id,
          filename: file.filename,
          mime: file.mime,
          localPath: file.localPath,
        });
        setFiles((current) =>
          current.map((item) =>
            item.id === file.id ? { ...item, persisted: true, localPath: stored.localPath } : item,
          ),
        );
      }
      router.back();
    } catch (error) {
      alertError(error);
      savingRef.current = false;
      setSaving(false);
    } finally {
      if (written) pushTodoChanges(db);
    }
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          ...stackOptions(todoId ? "Edit" : "New todo"),
          headerRight: () => <SaveButton disabled={!canSave} onPress={() => void save()} />,
        }}
      />
      <SyncBar />
      {ready ? (
        <ScrollView
          style={styles.form}
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <TextInput
            value={titleText}
            onChangeText={setTitleText}
            placeholder="Title"
            placeholderTextColor={colors.secondary}
            style={styles.titleInput}
          />
          <TextInput
            value={noteText}
            onChangeText={setNoteText}
            placeholder="Note"
            placeholderTextColor={colors.secondary}
            multiline
            textAlignVertical="top"
            style={styles.noteInput}
          />
          <View style={styles.actions}>
            <AttachButton
              icon="camera-outline"
              label="Camera"
              disabled={full || saving}
              onPress={takePhoto}
            />
            <AttachButton
              icon="images-outline"
              label="Gallery"
              disabled={full || saving}
              onPress={pickPhoto}
            />
            <AttachButton
              icon="document-outline"
              label="Document"
              disabled={full || saving}
              onPress={pickDocument}
            />
          </View>
          {files.map((file) => (
            <View key={file.id} style={styles.file}>
              {file.mime.startsWith("image/") ? (
                <Image source={{ uri: file.localPath }} style={styles.preview} contentFit="cover" />
              ) : (
                <Ionicons name="document-outline" size={28} color={colors.secondary} />
              )}
              <Text numberOfLines={2} style={styles.filename}>
                {file.filename}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove"
                hitSlop={8}
                onPress={() => removeFile(file.id)}
                style={styles.remove}
              >
                <Ionicons name="close" size={22} color={colors.secondary} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function SaveButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Save"
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
    >
      <Text style={[styles.save, disabled && styles.disabled]}>Save</Text>
    </Pressable>
  );
}

function AttachButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "camera-outline" | "images-outline" | "document-outline";
  label: string;
  disabled: boolean;
  onPress: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.attach,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={22} color={colors.blue} />
      <Text style={styles.attachLabel}>{label}</Text>
    </Pressable>
  );
}

function assertAttachment(count: number, file: PickedFile) {
  if (count >= maxFiles) throw new Error("Too many files");
  const filename = file.filename.trim().split(/[/\\]/).pop() ?? "";
  if (!filename || filename === "." || filename === "..") throw new Error("Filename is required");
  const mime = file.mime.trim().toLowerCase();
  if (!mime || mime.startsWith("video/")) throw new Error("This file type is not accepted");
  const stored = new File(file.localPath);
  const size = file.size ?? (stored.exists ? stored.size : undefined);
  if (size == null) throw new Error("File is missing");
  if (size > maxFileBytes) throw new Error("File is too large");
}

function nameFromUri(uri: string, fallback: string) {
  const name = decodeURIComponent(uri.split("?")[0].split("/").pop() ?? "");
  if (!name || name === "." || name === "..") return fallback;
  return name;
}

function mimeFromName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "heic" || extension === "heif") return "image/heic";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function alertError(error: unknown) {
  Alert.alert(error instanceof Error ? error.message : "Could not save");
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  form: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  titleInput: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    color: colors.label,
    fontSize: 17,
    paddingVertical: 14,
  },
  noteInput: {
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    color: colors.label,
    fontSize: 17,
    minHeight: 120,
    paddingBottom: 14,
    paddingTop: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 12,
  },
  attach: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    minHeight: 64,
    justifyContent: "center",
  },
  attachLabel: {
    color: colors.blue,
    fontSize: 13,
  },
  file: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    minHeight: 72,
  },
  preview: {
    borderCurve: "continuous",
    borderRadius: 8,
    height: 56,
    width: 56,
  },
  filename: {
    color: colors.label,
    flex: 1,
    fontSize: 17,
  },
  remove: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  save: {
    color: colors.blue,
    fontSize: 17,
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.35,
  },
  pressed: {
    opacity: 0.45,
  },
});

import { Ionicons } from "@expo/vector-icons";
import { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useInstallationId } from "./installation";
import {
  getSyncSnapshot,
  retrySync,
  setManualOnline,
  subscribeSync,
  type SyncStatus,
} from "./sync";
import { colors } from "./theme";

const labels: Record<SyncStatus, string> = {
  offline: "Offline",
  syncing: "Syncing",
  synced: "Synced",
  "out-of-sync": "Out of sync",
};

const badgeColors: Record<SyncStatus, string> = {
  offline: colors.box,
  syncing: colors.blue,
  synced: colors.green,
  "out-of-sync": colors.red,
};

export function SyncBar() {
  const id = useInstallationId();
  const sync = useSyncExternalStore(subscribeSync, getSyncSnapshot);
  return (
    <View style={styles.bar}>
      <Text style={[styles.badge, { backgroundColor: badgeColors[sync.status] }]}>
        {labels[sync.status]}
      </Text>
      <Text style={styles.user}>User {id.slice(0, 8)}</Text>
      {sync.status === "out-of-sync" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sync"
          hitSlop={8}
          onPress={retrySync}
          style={styles.sync}
        >
          <Ionicons name="sync-outline" size={22} color={colors.blue} />
        </Pressable>
      ) : null}
      <View style={styles.spacer} />
      <Switch
        accessibilityLabel="Online"
        disabled={!sync.toggleEnabled}
        onValueChange={setManualOnline}
        trackColor={{ false: colors.line, true: colors.blue }}
        value={sync.toggleOn}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderBottomColor: colors.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  badge: {
    borderRadius: 6,
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  user: {
    color: colors.secondary,
    fontSize: 15,
  },
  sync: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  spacer: {
    flex: 1,
  },
});

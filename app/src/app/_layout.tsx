import { Stack } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { StatusBar } from "expo-status-bar";
import { useEffect, type ReactNode } from "react";
import { Appearance } from "react-native";
import { databaseName, migrate } from "../db";
import { InstallationProvider } from "../installation";
import { watchNetwork } from "../sync";

Appearance.setColorScheme("light");

export default function RootLayout() {
  return (
    <InstallationProvider>
      <SQLiteProvider databaseName={databaseName} onInit={migrate}>
        <Network>
          <StatusBar style="dark" />
          <Stack />
        </Network>
      </SQLiteProvider>
    </InstallationProvider>
  );
}

function Network({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  useEffect(() => watchNetwork(db), [db]);
  return children;
}

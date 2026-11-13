import { Stack } from 'expo-router'
import { SQLiteProvider } from 'expo-sqlite'
import { StatusBar } from 'expo-status-bar'
import { databaseName, migrate } from '../db'
import { InstallationProvider } from '../installation'

export default function RootLayout() {
  return (
    <InstallationProvider>
      <SQLiteProvider databaseName={databaseName} onInit={migrate}>
        <StatusBar style="auto" />
        <Stack />
      </SQLiteProvider>
    </InstallationProvider>
  )
}

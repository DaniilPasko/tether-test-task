import { Stack } from 'expo-router'
import { SQLiteProvider } from 'expo-sqlite'
import { StatusBar } from 'expo-status-bar'
import { Appearance } from 'react-native'
import { databaseName, migrate } from '../db'
import { InstallationProvider } from '../installation'

Appearance.setColorScheme('light')

export default function RootLayout() {
  return (
    <InstallationProvider>
      <SQLiteProvider databaseName={databaseName} onInit={migrate}>
        <StatusBar style="dark" />
        <Stack />
      </SQLiteProvider>
    </InstallationProvider>
  )
}

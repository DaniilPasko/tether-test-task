import { Stack } from 'expo-router'
import { StyleSheet, View } from 'react-native'

export default function HomeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Todos' }} />
      <View style={styles.screen} />
    </>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
})

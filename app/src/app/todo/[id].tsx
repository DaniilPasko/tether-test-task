import { Stack } from 'expo-router'
import { View } from 'react-native'
import { colors, stackOptions } from '../../theme'

export default function TodoScreen() {
  return (
    <>
      <Stack.Screen options={stackOptions('Todo')} />
      <View style={{ flex: 1, backgroundColor: colors.background }} />
    </>
  )
}

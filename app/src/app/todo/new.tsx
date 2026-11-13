import { Stack } from 'expo-router'
import { View } from 'react-native'
import { colors, stackOptions } from '../../theme'

export default function NewTodoScreen() {
  return (
    <>
      <Stack.Screen options={stackOptions('New todo')} />
      <View style={{ flex: 1, backgroundColor: colors.background }} />
    </>
  )
}

import { useLocalSearchParams } from 'expo-router'
import Editor from '../../editor'

export default function TodoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const todoId = Array.isArray(id) ? id[0] : id
  return <Editor todoId={todoId} />
}

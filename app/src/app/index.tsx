import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useSQLiteContext } from "expo-sqlite";
import { useCallback, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SyncBar } from "../sync-bar";
import { pushTodoChanges } from "../sync";
import { colors, stackOptions } from "../theme";
import { deleteTodo, listTodos, updateTodo, type Todo } from "../todos";

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const pending = useRef(Promise.resolve());

  const reload = useCallback(async () => {
    setTodos(await listTodos(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      listTodos(db).then((rows) => {
        if (active) setTodos(rows);
      });
      return () => {
        active = false;
      };
    }, [db]),
  );

  function run(task: () => Promise<void>) {
    pending.current = pending.current.then(task, task);
  }

  function open(id: string) {
    router.push({ pathname: "/todo/[id]", params: { id } });
  }

  function toggle(id: string, completed: boolean) {
    setTodos(
      (current) =>
        current?.map((todo) => (todo.id === id ? { ...todo, completed } : todo)) ?? current,
    );
    run(async () => {
      try {
        await updateTodo(db, id, { completed });
        pushTodoChanges(db);
      } catch {
        await reload();
      }
    });
  }

  function remove(id: string) {
    setTodos((current) => current?.filter((todo) => todo.id !== id) ?? current);
    run(async () => {
      try {
        await deleteTodo(db, id);
        pushTodoChanges(db);
      } catch {
        await reload();
      }
    });
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          ...stackOptions("Todos"),
          headerLargeTitleEnabled: true,
          headerRight: () => <AddButton />,
        }}
      />
      <FlatList
        data={todos ?? []}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={SyncBar}
        contentContainerStyle={todos?.length ? undefined : styles.emptyList}
        renderItem={({ item }) => (
          <TodoRow
            id={item.id}
            title={item.title}
            completed={item.completed}
            onOpen={open}
            onToggle={toggle}
            onDelete={remove}
          />
        )}
        ListEmptyComponent={todos ? EmptyList : undefined}
      />
    </View>
  );
}

function AddButton() {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add"
      hitSlop={8}
      onPress={() => router.push("/todo/new")}
    >
      <Text style={styles.add}>Add</Text>
    </Pressable>
  );
}

function TodoRow({
  id,
  title,
  completed,
  onOpen,
  onToggle,
  onDelete,
}: {
  id: string;
  title: string;
  completed: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, completed: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.line }]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={title}
        accessibilityState={{ checked: completed }}
        hitSlop={8}
        onPress={() => onToggle(id, !completed)}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
      >
        <View
          style={[
            styles.box,
            { borderColor: completed ? colors.blue : colors.box },
            completed && { backgroundColor: colors.blue },
          ]}
        >
          {completed ? <Text style={styles.mark}>✓</Text> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpen(id)}
        style={({ pressed }) => [styles.titleHit, pressed && styles.pressed]}
      >
        <Text
          numberOfLines={2}
          style={[
            styles.title,
            { color: completed ? colors.secondary : colors.label },
            completed && styles.done,
          ]}
        >
          {title}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete"
        hitSlop={8}
        onPress={() => onDelete(id)}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
      >
        <Ionicons name="trash-outline" size={22} color={colors.red} />
      </Pressable>
    </View>
  );
}

function EmptyList() {
  return (
    <View style={styles.empty}>
      <Text style={{ color: colors.secondary }}>No todos</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  emptyList: {
    flexGrow: 1,
  },
  empty: {
    alignItems: "center",
    paddingTop: 48,
  },
  add: {
    color: colors.blue,
    fontSize: 17,
    fontWeight: "600",
  },
  row: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 4,
    minHeight: 52,
    paddingLeft: 8,
    paddingRight: 4,
  },
  hit: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  titleHit: {
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingVertical: 8,
  },
  pressed: {
    opacity: 0.45,
  },
  box: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  mark: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 16,
  },
  title: {
    fontSize: 17,
  },
  done: {
    textDecorationLine: "line-through",
  },
});

export const colors = {
  background: "#ffffff",
  label: "#000000",
  secondary: "#6b6b6b",
  line: "#d9d9d9",
  blue: "#007aff",
  green: "#34c759",
  red: "#ff3b30",
  box: "#8e8e93",
};

export function stackOptions(title: string) {
  return {
    title,
    headerTintColor: colors.blue,
    headerStyle: { backgroundColor: colors.background },
    headerTitleStyle: { color: colors.label },
    headerLargeTitleStyle: { color: colors.label },
    contentStyle: { backgroundColor: colors.background },
  };
}

import type { Entity } from "@/@shared/patch-db/interface";
import { useEntities, useEntity, usePatchesDb } from "@/@shared/patch-db/react";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useState } from "react";
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    TextInput,
} from "react-native";

const DELETED_CLAUSE = {
    type: "or" as const,
    clauses: [
        { type: "not_exists" as const, attribute: "deleted" },
        { type: "=" as const, attribute: "deleted", value: false },
    ],
};

const ACTIVE_CLAUSE = {
    type: "or" as const,
    clauses: [
        { type: "not_exists" as const, attribute: "completed" },
        { type: "=" as const, attribute: "completed", value: false },
    ],
};

function buildTodoQuery(filter: Filter) {
    const where =
        filter === "all"
            ? DELETED_CLAUSE
            : filter === "active"
                ? { type: "and" as const, clauses: [DELETED_CLAUSE, ACTIVE_CLAUSE] }
                : {
                    type: "and" as const,
                    clauses: [DELETED_CLAUSE, { type: "=" as const, attribute: "completed", value: true }],
                };
    return {
        entityType: "todo" as const,
        where,
        orderBy: [
            { attribute: "order", direction: "asc" as const },
            { attribute: "createdAt", direction: "asc" as const },
        ],
    };
}

type TodoEntity = Entity & { attributes: { title?: string; completed?: boolean; order?: number } };

function TodoItem({
    entityId,
    onToggle,
    onDelete,
}: {
    entityId: string;
    onToggle: () => void;
    onDelete: () => void;
}) {
    const colorScheme = useColorScheme();
    const tint = Colors[colorScheme ?? "light"].tint;
    const entity = useEntity({ entityId, entityType: "todo" });
    const completed = entity?.attributes.completed === true;
    const title = (entity?.attributes.title as string) ?? "";

    return (
        <ThemedView style={styles.todoRow}>
            <Pressable onPress={onToggle} style={styles.todoToggleArea}>
                <ThemedText style={[styles.checkboxText, completed && styles.completedText]}>
                    {completed ? "✓" : "○"}
                </ThemedText>
                <ThemedText
                    style={[styles.todoTitle, completed && styles.completedText]}
                    numberOfLines={1}
                >
                    {title || "(untitled)"}
                </ThemedText>
            </Pressable>
            <Pressable onPress={onDelete} style={styles.deleteButton} hitSlop={8}>
                <ThemedText style={[styles.deleteText, { color: tint }]}>Delete</ThemedText>
            </Pressable>
        </ThemedView>
    );
}

type Filter = "all" | "active" | "completed";

export function TodoList() {
    const db = usePatchesDb();
    const [input, setInput] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const allResult = useEntities(buildTodoQuery("all"));
    const filterResult = useEntities(buildTodoQuery(filter));
    const todos = filterResult.data as TodoEntity[];
    const totalCount = allResult.total;
    const filterActiveBg = useThemeColor({
        light: "rgba(10, 126, 164, 0.2)",
        dark: "rgba(255, 255, 255, 0.15)"
    }, "tint");
    const inputBg = useThemeColor({}, "background");
    const inputColor = useThemeColor({}, "text");
    const borderColor = useThemeColor({ light: "#ccc", dark: "#444" }, "icon");

    const addTodo = async () => {
        const title = input.trim();
        if (!title) return;
        const entityId = crypto.randomUUID();
        await db.patch([
            {
                entityId,
                entityType: "todo",
                attributes: {
                    title,
                    completed: false,
                    order: totalCount,
                    createdAt: new Date().toISOString(),
                },
            },
        ]);
        setInput("");
    };

    const toggleTodo = async (entity: TodoEntity) => {
        const completed = entity.attributes.completed === true;
        await db.patch([
            {
                entityId: entity.entityId,
                entityType: "todo",
                attributes: { completed: !completed },
            },
        ]);
    };

    const deleteTodo = async (entity: TodoEntity) => {
        await db.patch([
            {
                entityId: entity.entityId,
                entityType: "todo",
                attributes: { deleted: true },
            },
        ]);
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.container}
        >
            <ThemedView style={styles.header}>
                <ThemedText type="title">Todos</ThemedText>
                <ThemedText type="subtitle">Powered by patch-db</ThemedText>
            </ThemedView>
            <ThemedView style={styles.filterRow}>
                <Pressable
                    onPress={() => setFilter("all")}
                    style={[styles.filterButton, filter === "all" && { backgroundColor: filterActiveBg }]}
                >
                    <ThemedText style={filter === "all" ? styles.filterTextActive : undefined}>
                        All
                    </ThemedText>
                </Pressable>
                <Pressable
                    onPress={() => setFilter("active")}
                    style={[styles.filterButton, filter === "active" && { backgroundColor: filterActiveBg }]}
                >
                    <ThemedText style={filter === "active" ? styles.filterTextActive : undefined}>
                        Active
                    </ThemedText>
                </Pressable>
                <Pressable
                    onPress={() => setFilter("completed")}
                    style={[styles.filterButton, filter === "completed" && { backgroundColor: filterActiveBg }]}
                >
                    <ThemedText style={filter === "completed" ? styles.filterTextActive : undefined}>
                        Completed
                    </ThemedText>
                </Pressable>
            </ThemedView>
            <ThemedView style={styles.inputRow}>
                <TextInput
                    style={[styles.input, { backgroundColor: inputBg, color: inputColor, borderColor }]}
                    placeholder="Add a todo..."
                    placeholderTextColor={Colors.light.icon}
                    value={input}
                    onChangeText={setInput}
                    onSubmitEditing={addTodo}
                    returnKeyType="done"
                />
                <Pressable onPress={addTodo} style={styles.addButton}>
                    <ThemedText type="defaultSemiBold">Add</ThemedText>
                </Pressable>
            </ThemedView>
            <ThemedView style={styles.list}>
                {todos.length === 0 ? (
                    <ThemedText style={styles.empty}>
                        {filter === "all" ? "No todos yet. Add one above!" : `No ${filter} todos.`}
                    </ThemedText>
                ) : (
                    todos.map((entity) => (
                        <TodoItem
                            key={entity.entityId}
                            entityId={entity.entityId}
                            onToggle={() => toggleTodo(entity)}
                            onDelete={() => deleteTodo(entity)}
                        />
                    ))
                )}
            </ThemedView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    header: {
        marginBottom: 16,
    },
    filterRow: {
        flexDirection: "row",
        gap: 8,
        marginBottom: 12,
    },
    filterButton: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    filterTextActive: {
        fontWeight: "600",
    },
    inputRow: {
        flexDirection: "row",
        gap: 8,
        marginBottom: 16,
    },
    input: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 16,
    },
    addButton: {
        justifyContent: "center",
        paddingHorizontal: 16,
    },
    list: {
        flex: 1,
    },
    todoRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 0,
        gap: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#ccc",
    },
    todoToggleArea: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    checkbox: {
        width: 28,
        alignItems: "center",
    },
    checkboxText: {
        fontSize: 20,
    },
    todoTitle: {
        flex: 1,
        fontSize: 16,
    },
    completedText: {
        textDecorationLine: "line-through",
        opacity: 0.6,
    },
    deleteButton: {
        padding: 4,
    },
    deleteText: {
        fontSize: 14,
    },
    empty: {
        opacity: 0.7,
        fontStyle: "italic",
    },
});

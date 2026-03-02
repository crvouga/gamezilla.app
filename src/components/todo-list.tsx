import type { Entity } from "@/@shared/patch-db/interface";
import { makePatchInput } from "@/@shared/patch-db/make-patch";
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

const TODO_QUERY = {
    entityType: "todo" as const,
    where: {
        type: "or" as const,
        clauses: [
            { type: "not_exists" as const, attribute: "deleted" },
            { type: "=" as const, attribute: "deleted", value: false },
        ],
    },
    orderBy: [
        { attribute: "order", direction: "asc" as const },
        { attribute: "createdAt", direction: "asc" as const },
    ],
};

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
            <Pressable onPress={onToggle} style={styles.checkbox} hitSlop={8}>
                <ThemedText style={[styles.checkboxText, completed && styles.completedText]}>
                    {completed ? "✓" : "○"}
                </ThemedText>
            </Pressable>
            <ThemedText
                style={[styles.todoTitle, completed && styles.completedText]}
                numberOfLines={1}
            >
                {title || "(untitled)"}
            </ThemedText>
            <Pressable onPress={onDelete} style={styles.deleteButton} hitSlop={8}>
                <ThemedText style={[styles.deleteText, { color: tint }]}>Delete</ThemedText>
            </Pressable>
        </ThemedView>
    );
}

export function TodoList() {
    const db = usePatchesDb();
    const result = useEntities(TODO_QUERY);
    const [input, setInput] = useState("");
    const todos = result.data as TodoEntity[];
    const inputBg = useThemeColor({}, "background");
    const inputColor = useThemeColor({}, "text");
    const borderColor = useThemeColor({ light: "#ccc", dark: "#444" }, "icon");

    const addTodo = async () => {
        const title = input.trim();
        if (!title) return;
        const entityId = crypto.randomUUID();
        const patchId = crypto.randomUUID();
        await db.write([
            makePatchInput({
                patchId,
                entityId,
                entityType: "todo",
                attributes: {
                    title,
                    completed: false,
                    order: todos.length,
                    createdAt: new Date().toISOString(),
                },
            }),
        ]);
        setInput("");
    };

    const toggleTodo = async (entity: TodoEntity) => {
        const completed = entity.attributes.completed === true;
        await db.write([
            makePatchInput({
                patchId: crypto.randomUUID(),
                entityId: entity.entityId,
                entityType: "todo",
                attributes: { completed: !completed },
            }),
        ]);
    };

    const deleteTodo = async (entity: TodoEntity) => {
        await db.write([
            makePatchInput({
                patchId: crypto.randomUUID(),
                entityId: entity.entityId,
                entityType: "todo",
                attributes: { deleted: true },
            }),
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
                    <ThemedText style={styles.empty}>No todos yet. Add one above!</ThemedText>
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

import type { Entity } from "@/@shared/patch-db/interface";
import { makePatchInput } from "@/@shared/patch-db/make-patch";
import { useEntities, usePatchesDb } from "@/@shared/patch-db/react";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useThemeColor } from "@/hooks/use-theme-color";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    FlatList,
    Pressable,
    StyleSheet,
    TextInput,
} from "react-native";

const INBOX_LIST_ID = "__inbox__";

const DELETED_CLAUSE = {
    type: "or" as const,
    clauses: [
        { type: "not_exists" as const, attribute: "deleted" },
        { type: "=" as const, attribute: "deleted", value: false },
    ],
};

type TodoListEntity = Entity & {
    attributes: { name?: string; order?: number; createdAt?: string };
};

type TodoEntity = Entity & { attributes: { listId?: string } };

function useTodoCountByList() {
    const todosResult = useEntities({
        entityType: "todo",
        where: DELETED_CLAUSE,
    });
    const todos = (todosResult.data ?? []) as TodoEntity[];
    const counts = new Map<string, number>();
    for (const t of todos) {
        const lid = t.attributes.listId ?? INBOX_LIST_ID;
        counts.set(lid, (counts.get(lid) ?? 0) + 1);
    }
    return counts;
}

export function TodoListsOverview() {
    const router = useRouter();
    const db = usePatchesDb();
    const [input, setInput] = useState("");
    const [adding, setAdding] = useState(false);

    const listsResult = useEntities({
        entityType: "todoList",
        where: DELETED_CLAUSE,
        orderBy: [
            { attribute: "order", direction: "asc" as const },
            { attribute: "createdAt", direction: "asc" as const },
        ],
    });
    const lists = (listsResult.data ?? []) as TodoListEntity[];
    const todoCounts = useTodoCountByList();

    const filterActiveBg = useThemeColor({
        light: "rgba(10, 126, 164, 0.2)",
        dark: "rgba(255, 255, 255, 0.15)",
    }, "tint");
    const inputBg = useThemeColor({}, "background");
    const inputColor = useThemeColor({}, "text");
    const borderColor = useThemeColor({ light: "#ccc", dark: "#444" }, "icon");

    const addList = async () => {
        const name = input.trim();
        if (!name) {
            setAdding(false);
            return;
        }
        const entityId = crypto.randomUUID();
        const patchId = crypto.randomUUID();
        await db.write([
            makePatchInput({
                patchId,
                entityId,
                entityType: "todoList",
                attributes: {
                    name,
                    order: lists.length,
                    createdAt: new Date().toISOString(),
                },
            }),
        ]);
        setInput("");
        setAdding(false);
    };

    const openList = (listId: string) => {
        router.push(`/todos/${listId}`);
    };

    const inboxCount = todoCounts.get(INBOX_LIST_ID) ?? 0;

    const data: { id: string; name: string; count: number }[] = [
        { id: INBOX_LIST_ID, name: "Inbox", count: inboxCount },
        ...lists.map((l) => ({
            id: l.entityId,
            name: (l.attributes.name as string) ?? "Untitled",
            count: todoCounts.get(l.entityId) ?? 0,
        })),
    ];

    return (
        <ThemedView style={styles.container}>
            <ThemedView style={styles.header}>
                <ThemedText type="title">Todo Lists</ThemedText>
                <ThemedText type="subtitle">Group your todos by list</ThemedText>
            </ThemedView>

            {adding ? (
                <ThemedView style={styles.inputRow}>
                    <TextInput
                        style={[styles.input, { backgroundColor: inputBg, color: inputColor, borderColor }]}
                        placeholder="List name..."
                        placeholderTextColor="#888"
                        value={input}
                        onChangeText={setInput}
                        onSubmitEditing={addList}
                        onBlur={() => {
                            if (!input.trim()) setAdding(false);
                        }}
                        autoFocus
                    />
                    <Pressable onPress={addList} style={styles.addButton}>
                        <ThemedText type="defaultSemiBold">Add</ThemedText>
                    </Pressable>
                </ThemedView>
            ) : (
                <Pressable
                    onPress={() => setAdding(true)}
                    style={[styles.addListButton, { backgroundColor: filterActiveBg }]}
                >
                    <ThemedText type="defaultSemiBold">+ New List</ThemedText>
                </Pressable>
            )}

            <FlatList
                data={data}
                keyExtractor={(item) => item.id}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                    <Pressable
                        onPress={() => openList(item.id)}
                        style={({ pressed }) => [
                            styles.listRow,
                            pressed && styles.listRowPressed,
                        ]}
                    >
                        <ThemedText style={styles.listName}>{item.name}</ThemedText>
                        <ThemedText style={styles.listCount}>{item.count}</ThemedText>
                    </Pressable>
                )}
                ListEmptyComponent={
                    <ThemedText style={styles.empty}>
                        No lists yet. Create one above or add todos to Inbox.
                    </ThemedText>
                }
            />
        </ThemedView>
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
        marginBottom: 12,
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
    addListButton: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        marginBottom: 16,
        alignItems: "center",
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingBottom: 24,
    },
    listRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 14,
        paddingHorizontal: 12,
        borderRadius: 8,
        marginBottom: 4,
    },
    listRowPressed: {
        opacity: 0.7,
    },
    listName: {
        fontSize: 17,
        fontWeight: "500",
    },
    listCount: {
        fontSize: 15,
        opacity: 0.6,
    },
    empty: {
        opacity: 0.7,
        fontStyle: "italic",
        marginTop: 24,
    },
});

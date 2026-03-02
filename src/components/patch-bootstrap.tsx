import type { Container } from "@/@shared/dependency-injection/dependency-injection-container";
import { ContainerProvider } from "@/@shared/dependency-injection/react";
import { useTheme } from "@/@shared/theme";
import { bootstrapPatchDbExpoSync } from "@/@shared/patch-db/bootstrap-expo";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator } from "react-native";

export function PatchBootstrap({ children }: { children: ReactNode }) {
    const theme = useTheme();
    const [container, setContainer] = useState<Container | null>(null);

    useEffect(() => {
        let cancelled = false;
        bootstrapPatchDbExpoSync()
            .then(({ container: c }) => {
                if (!cancelled) setContainer(c);
            })
            .catch((err) => {
                if (!cancelled) console.error("PatchBootstrap failed:", err);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    if (!container) {
        return (
            <ThemedView style={theme.sx({ flex: 1, justifyContent: "center", alignItems: "center", gap: 4 })}>
                <ActivityIndicator size="large" />
                <ThemedText style={theme.sx({ fontSize: 16 })}>Loading container...</ThemedText>
            </ThemedView>
        );
    }

    return <ContainerProvider container={container}>{children}</ContainerProvider>;
}

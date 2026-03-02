import { DependencyInjectionContainer } from "../dependency-injection/dependency-injection-container";
import { InMemoryPubSub } from "../pub-sub/impl-in-memory";
import { SqlClientImplExpoSqlite } from "../sql-client/impl-expo-sqlite";
import { PatchDbImplHttp } from "./impl-http";
import { PatchDbImplSqlite } from "./impl-sqlite/impl-sqlite";
import { SyncPatchesDb } from "./impl-sync";
import { PatchesDbToken } from "./react";
import { SubscribablePatchesDbToken } from "./subscribable";

export type BootstrapResult = {
    container: DependencyInjectionContainer;
};

export type BootstrapPatchDbExpoSyncOptions = {
    databaseName?: string;
    apiUrl?: string;
    pollIntervalMs?: number;
    pushIntervalMs?: number;
};

export async function bootstrapPatchDbExpoSync(
    options: BootstrapPatchDbExpoSyncOptions = {}
): Promise<BootstrapResult> {
    const {
        databaseName = "todos",
        apiUrl = "http://localhost:5001",
        pollIntervalMs = 1000,
        pushIntervalMs = 2000,
    } = options;

    const sqlClient = await SqlClientImplExpoSqlite.open(databaseName);
    await sqlClient.connect();

    const localDb = new PatchDbImplSqlite(sqlClient);
    await localDb.migrate();

    const remoteDb = new PatchDbImplHttp(apiUrl);
    const pubSub = new InMemoryPubSub();
    const syncDb = new SyncPatchesDb(localDb, remoteDb, pubSub, { pollIntervalMs, pushIntervalMs });

    const container = new DependencyInjectionContainer();
    container.registerValue(PatchesDbToken, syncDb);
    container.registerValue(SubscribablePatchesDbToken, syncDb);

    return { container };
}

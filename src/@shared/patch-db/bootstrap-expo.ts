import { DependencyInjectionContainer } from "../dependency-injection/dependency-injection-container";
import { InMemoryPubSub } from "../pub-sub/impl-in-memory";
import { SqlClientImplExpoSqlite } from "../sql-client/impl-expo-sqlite";
import { PatchDbImplSqlite } from "./impl-sqlite/impl-sqlite";
import { PatchesDbToken } from "./react";
import { SubscribablePatchesDb, SubscribablePatchesDbToken } from "./subscribable";

export type BootstrapResult = {
    container: DependencyInjectionContainer;
};

export async function bootstrapPatchDbExpo(databaseName = "todos"): Promise<BootstrapResult> {
    const sqlClient = await SqlClientImplExpoSqlite.open(databaseName);
    await sqlClient.connect();

    const patchDb = new PatchDbImplSqlite(sqlClient);
    await patchDb.migrate();

    const pubSub = new InMemoryPubSub();
    const subscribableDb = new SubscribablePatchesDb(patchDb, pubSub);

    const container = new DependencyInjectionContainer();
    container.registerValue(PatchesDbToken, subscribableDb);
    container.registerValue(SubscribablePatchesDbToken, subscribableDb);

    return { container };
}

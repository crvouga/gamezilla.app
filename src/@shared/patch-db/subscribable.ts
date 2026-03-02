import { InjectionToken } from "../dependency-injection/dependency-injection-container";
import { PubSub, Unsubscribe } from "../pub-sub/interface";
import { Entity, Patch, PatchesDb, PatchesDbQuery, PatchesDbResult, PatchInput } from "./interface";

const PATCHES_DB_TOPIC = "patches-db";

export const SubscribablePatchesDbToken: InjectionToken<SubscribablePatchesDb> = Symbol("SubscribablePatchesDb");

export class SubscribablePatchesDb implements PatchesDb {
    constructor(private db: PatchesDb, private pubSub: PubSub) { }

    async write(patches: PatchInput[]): Promise<void> {
        await this.db.write(patches);
        this.pubSub.publish(PATCHES_DB_TOPIC, { type: "invalidated" });
    }

    patches(query: PatchesDbQuery): Promise<PatchesDbResult<Patch>> {
        return this.db.patches(query);
    }

    entities(query: PatchesDbQuery): Promise<PatchesDbResult<Entity>> {
        return this.db.entities(query);
    }

    subscribe = {
        patches: (query: PatchesDbQuery, listener: (result: PatchesDbResult<Patch>) => void): Unsubscribe => {
            const notify = async () => {
                const result = await this.db.patches(query);
                listener(result);
            };
            void notify();
            return this.pubSub.subscribe(PATCHES_DB_TOPIC, notify);
        },
        entities: (query: PatchesDbQuery, listener: (result: PatchesDbResult<Entity>) => void): Unsubscribe => {
            const notify = async () => {
                const result = await this.db.entities(query);
                listener(result);
            };
            void notify();
            return this.pubSub.subscribe(PATCHES_DB_TOPIC, notify);
        },
    };
}
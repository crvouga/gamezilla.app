import { Fact } from "../fact";

export interface FactDb {
    migrate(): Promise<void>;
    append(fact: Fact): Promise<void>;
    listByEntityId(entityId: string): Promise<Fact[]>;
}
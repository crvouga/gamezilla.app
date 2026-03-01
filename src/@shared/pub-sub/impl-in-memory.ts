import type { Listener, PublishSubscribe, Unsubscribe } from "./interface";

export class InMemoryPublishSubscribe implements PublishSubscribe {
    private listeners = new Map<string, Set<Listener>>();

    publish<T = unknown>(topic: string, message: T): void {
        const set = this.listeners.get(topic);
        if (!set) return;
        for (const listener of set) {
            listener(message);
        }
    }

    subscribe<T = unknown>(topic: string, listener: Listener<T>): Unsubscribe {
        let set = this.listeners.get(topic);
        if (!set) {
            set = new Set();
            this.listeners.set(topic, set);
        }
        const wrapped = listener as Listener;
        set.add(wrapped);
        return () => {
            set!.delete(wrapped);
            if (set!.size === 0) {
                this.listeners.delete(topic);
            }
        };
    }
}

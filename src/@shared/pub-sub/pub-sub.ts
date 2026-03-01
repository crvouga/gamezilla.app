export type Listener<T = unknown> = (message: T) => void;

export type Unsubscribe = () => void;

export interface PublishSubscribe {
    publish<T = unknown>(topic: string, message: T): void;
    subscribe<T = unknown>(topic: string, listener: Listener<T>): Unsubscribe;
}

export function createPubSub(): PublishSubscribe {
    const listeners = new Map<string, Set<Listener>>();

    return {
        publish<T = unknown>(topic: string, message: T): void {
            const set = listeners.get(topic);
            if (!set) return;
            for (const listener of set) {
                listener(message);
            }
        },

        subscribe<T = unknown>(topic: string, listener: Listener<T>): Unsubscribe {
            let set = listeners.get(topic);
            if (!set) {
                set = new Set();
                listeners.set(topic, set);
            }
            const wrapped = listener as Listener;
            set.add(wrapped);
            return () => {
                set!.delete(wrapped);
                if (set!.size === 0) {
                    listeners.delete(topic);
                }
            };
        },
    };
}

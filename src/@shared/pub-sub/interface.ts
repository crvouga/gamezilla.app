export type Listener<T = unknown> = (message: T) => void;

export type Unsubscribe = () => void;

export interface PublishSubscribe {
    publish<T = unknown>(topic: string, message: T): void;
    subscribe<T = unknown>(topic: string, listener: Listener<T>): Unsubscribe;
}

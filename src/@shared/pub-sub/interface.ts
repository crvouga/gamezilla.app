export type Listener = (message: unknown) => void;

export type Unsubscribe = () => void;

export interface PublishSubscribe {
    publish(topic: string, message: unknown): void;
    subscribe(topic: string, listener: Listener): Unsubscribe;
}

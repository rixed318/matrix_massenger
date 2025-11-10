import type { UnlistenFn } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';

export interface BotBridgeWebhookPayload<T = unknown> {
    connectorId: string;
    event: string;
    data: T;
    receivedAt: number;
}

export type BotBridgeWebhookListener<T = unknown> = (payload: BotBridgeWebhookPayload<T>) => void;

const WEBHOOK_EVENT = 'bot-bridge://webhook';
const emitter = new EventTarget();

const isTauri = typeof window !== 'undefined' && Boolean((window as any).__TAURI__);
let tauriUnlistenPromise: Promise<UnlistenFn | null> | null = null;

const ensureTauriListener = () => {
    if (!isTauri || tauriUnlistenPromise) return;
    tauriUnlistenPromise = listen<{ connectorId: string; event: string; data: unknown; receivedAt?: number }>(
        WEBHOOK_EVENT,
        ({ payload }) => {
            const detail: BotBridgeWebhookPayload = {
                connectorId: payload.connectorId,
                event: payload.event,
                data: payload.data,
                receivedAt: payload.receivedAt ?? Date.now(),
            };
            emitBotBridgeWebhook(detail);
        },
    ).catch((error) => {
        console.warn('Failed to attach Tauri webhook listener', error);
        return null;
    });
};

export const emitBotBridgeWebhook = (payload: BotBridgeWebhookPayload): void => {
    emitter.dispatchEvent(new CustomEvent(WEBHOOK_EVENT, { detail: payload }));
};

export const onBotBridgeWebhook = <T = unknown>(listener: BotBridgeWebhookListener<T>): (() => void) => {
    ensureTauriListener();
    const wrapped = (event: Event) => {
        const custom = event as CustomEvent<BotBridgeWebhookPayload<T>>;
        listener(custom.detail);
    };
    emitter.addEventListener(WEBHOOK_EVENT, wrapped as EventListener);
    return () => emitter.removeEventListener(WEBHOOK_EVENT, wrapped as EventListener);
};

export const disposeTauriWebhookListener = async (): Promise<void> => {
    if (!tauriUnlistenPromise) return;
    const unlisten = await tauriUnlistenPromise;
    tauriUnlistenPromise = null;
    if (typeof unlisten === 'function') {
        await unlisten();
    }
};

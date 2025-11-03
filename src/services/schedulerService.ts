import { ScheduledMessage } from '../types';

const STORAGE_KEY = 'matrix-scheduled-messages';

export const getScheduledMessages = (): ScheduledMessage[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.error("Failed to load scheduled messages from localStorage", e);
        return [];
    }
};

const saveScheduledMessages = (messages: ScheduledMessage[]): void => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
};

export const addScheduledMessage = (roomId: string, content: string, sendAt: number): ScheduledMessage => {
    const messages = getScheduledMessages();
    const newMessage: ScheduledMessage = {
        id: `scheduled_${Date.now()}`,
        roomId,
        content,
        sendAt,
    };
    saveScheduledMessages([...messages, newMessage]);
    return newMessage;
};

export const deleteScheduledMessage = (id: string): void => {
    let messages = getScheduledMessages();
    messages = messages.filter(msg => msg.id !== id);
    saveScheduledMessages(messages);
};

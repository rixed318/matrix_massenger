import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as notificationService from '../../src/services/notificationService';

declare global {
    // eslint-disable-next-line no-var
    var Notification: any;
    // eslint-disable-next-line no-var
    var navigator: any;
    // eslint-disable-next-line no-var
    var window: any;
}

const createNotificationMock = () => {
    const ctor = vi.fn(function Notification(this: any, title: string, options?: NotificationOptions) {
        this.title = title;
        this.options = options;
    });
    ctor.permission = 'granted';
    return ctor;
};

describe('notificationService', () => {
    let postMessageSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.restoreAllMocks();
        postMessageSpy = vi.fn();
        global.window = {} as any;
        global.navigator = {
            serviceWorker: {
                ready: Promise.resolve({ active: { postMessage: postMessageSpy } }),
                controller: { postMessage: postMessageSpy },
            },
        } as any;
        global.Notification = createNotificationMock();
    });

    afterEach(() => {
        delete global.Notification;
        delete global.navigator;
        delete global.window;
    });

    it('suppresses notifications when a room is muted', async () => {
        vi.spyOn(notificationService, 'checkPermission').mockResolvedValue(true);
        notificationService.setRoomNotificationPreference('!room:id', 'mute');

        await notificationService.sendNotification('Muted', 'Body', { roomId: '!room:id' });

        expect(global.Notification).not.toHaveBeenCalled();
    });

    it('allows notifications for mentions when mode is mentions only', async () => {
        vi.spyOn(notificationService, 'checkPermission').mockResolvedValue(true);
        notificationService.setRoomNotificationPreference('!room:id', 'mentions');

        await notificationService.sendNotification('Mention', 'Body', { roomId: '!room:id', isMention: true });
        expect(global.Notification).toHaveBeenCalledTimes(1);

        global.Notification.mockClear();

        await notificationService.sendNotification('Ignored', 'Body', { roomId: '!room:id', isMention: false });
        expect(global.Notification).toHaveBeenCalledTimes(0);
    });

    it('syncs preferences with the service worker', async () => {
        notificationService.setRoomNotificationPreferences({ '!room:a': 'mute', '!room:b': 'all' });
        await vi.waitFor(() => {
            expect(postMessageSpy).toHaveBeenCalledWith({
                type: 'ROOM_NOTIFICATION_PREFERENCES',
                preferences: { '!room:a': 'mute', '!room:b': 'all' },
            });
        });
    });
});

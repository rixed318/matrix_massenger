import { MatrixClient, MatrixEvent, MatrixRoom, MatrixUser, Sticker, Gif } from '../types';
// FIX: `RoomCreateOptions` is not an exported member of `matrix-js-sdk`. Replaced with the correct type `ICreateRoomOpts`.
// FIX: Import Visibility enum to correctly type room creation options.
import { createClient, ICreateClientOpts, EventType, MsgType, RelationType, ICreateRoomOpts, Visibility } from 'matrix-js-sdk';
import { IndexedDBCryptoStore } from 'matrix-js-sdk/lib/crypto/store/indexeddb-crypto-store';
import { LocalStorageCryptoStore } from 'matrix-js-sdk/lib/crypto/store/localStorage-crypto-store';
import { MemoryCryptoStore } from 'matrix-js-sdk/lib/crypto/store/memory-crypto-store';
import type { CryptoStore } from 'matrix-js-sdk/lib/crypto/store/base';

const CRYPTO_DB_NAME = 'matrix-messenger-crypto';
const DEVICE_STORAGE_KEY = 'matrix-device-id';
const SECRET_STORAGE_KEY_PREFIX = 'matrix-secret-storage:';

const getBrowserStorage = (): Storage | undefined => {
    if (typeof window === 'undefined') {
        return undefined;
    }
    try {
        return window.localStorage;
    } catch (error) {
        console.warn('Local storage unavailable for session persistence', error);
        return undefined;
    }
};

const createCryptoStore = (): CryptoStore | undefined => {
    if (typeof window === 'undefined') {
        return new MemoryCryptoStore();
    }
    if (window.indexedDB) {
        return new IndexedDBCryptoStore(window.indexedDB, CRYPTO_DB_NAME);
    }
    if (window.localStorage) {
        return new LocalStorageCryptoStore(window.localStorage);
    }
    return new MemoryCryptoStore();
};

const resolveStoredDeviceId = (userId?: string): string | undefined => {
    const storage = getBrowserStorage();
    if (!storage || !userId) {
        return undefined;
    }
    return storage.getItem(`${DEVICE_STORAGE_KEY}:${userId}`) || undefined;
};

const persistDeviceId = (userId: string, deviceId: string | undefined): void => {
    const storage = getBrowserStorage();
    if (!storage || !deviceId) {
        return;
    }
    storage.setItem(`${DEVICE_STORAGE_KEY}:${userId}`, deviceId);
};

const markSecretStorageReady = (userId: string): void => {
    const storage = getBrowserStorage();
    if (!storage) {
        return;
    }
    storage.setItem(`${SECRET_STORAGE_KEY_PREFIX}${userId}`, 'true');
};

const isSecretStorageMarkedReady = (userId: string): boolean => {
    const storage = getBrowserStorage();
    if (!storage) {
        return false;
    }
    return storage.getItem(`${SECRET_STORAGE_KEY_PREFIX}${userId}`) === 'true';
};

const attachSessionStore = (options: ICreateClientOpts): void => {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        const sessionStore = window.sessionStorage;
        if (sessionStore) {
            (options as ICreateClientOpts & { sessionStore?: Storage }).sessionStore = sessionStore;
        }
    } catch (error) {
        console.warn('Session storage unavailable for Matrix session persistence', error);
    }
};

// *** ВАЖНО: Укажите здесь URL вашего сервера для перевода ***
const TRANSLATION_SERVER_URL = 'https://your-translation-server.com/api/translate';


export const initClient = (homeserverUrl: string, accessToken?: string, userId?: string, deviceId?: string): MatrixClient => {
    const options: ICreateClientOpts = {
        baseUrl: homeserverUrl,
        cryptoStore: createCryptoStore(),
    };
    if (accessToken && userId) {
        options.accessToken = accessToken;
        options.userId = userId;
    }

    const resolvedDeviceId = deviceId || resolveStoredDeviceId(userId);
    if (resolvedDeviceId) {
        options.deviceId = resolvedDeviceId;
    }

    attachSessionStore(options);
    return createClient(options);
};

const waitForCryptoStore = async (client: MatrixClient): Promise<void> => {
    const cryptoStore = (client as MatrixClient & { cryptoStore?: { startup?: () => Promise<unknown>; startupPromise?: Promise<unknown>; } }).cryptoStore;
    try {
        if (cryptoStore?.startup) {
            await cryptoStore.startup();
        } else if (cryptoStore?.startupPromise) {
            await cryptoStore.startupPromise;
        }
    } catch (error) {
        console.warn('Failed to initialise crypto store', error);
    }
};

export const ensureCryptoIsReady = async (client: MatrixClient): Promise<void> => {
    try {
        await client.initCrypto();
        await waitForCryptoStore(client);
    } catch (error) {
        console.warn('Failed to initialise Matrix crypto engine', error);
        return;
    }

    const userId = client.getUserId();
    if (!userId) {
        return;
    }

    if (!isSecretStorageMarkedReady(userId)) {
        try {
            await client.bootstrapSecretStorage({ setupNewKeyBackup: true });
            const backupInfo = await client.getKeyBackupVersion();
            if (backupInfo) {
                await client.enableKeyBackup(backupInfo);
            }
            markSecretStorageReady(userId);
        } catch (error) {
            console.warn('Automatic secret storage bootstrap failed', error);
        }
    } else {
        try {
            const backupEnabled = client.getKeyBackupEnabled();
            if (!backupEnabled) {
                const backupInfo = await client.getKeyBackupVersion();
                if (backupInfo) {
                    await client.enableKeyBackup(backupInfo);
                }
            }
        } catch (error) {
            console.warn('Failed to re-enable key backup', error);
        }
    }
};

export const login = async (homeserverUrl: string, username: string, password: string): Promise<MatrixClient> => {
    const client = initClient(homeserverUrl);
    const loginResponse = await client.loginWithPassword(username, password);

    const userId = loginResponse.user_id || client.getUserId();
    const deviceId = loginResponse.device_id || client.getDeviceId();

    if (userId && deviceId) {
        persistDeviceId(userId, deviceId);
    }

    await ensureCryptoIsReady(client);
    await client.startClient({ initialSyncLimit: 10 });
    return client;
};

export const findOrCreateSavedMessagesRoom = async (client: MatrixClient): Promise<string> => {
    const userId = client.getUserId()!;
    // FIX: The type 'm.direct' is not present in the SDK's AccountDataEvents type definitions.
    // Casting to `any` bypasses this strict type check for a valid, but untyped, event.
    const directRooms = client.getAccountData('m.direct' as any)?.getContent() || {};
    
    // Check if a DM with self already exists in account data
    if (directRooms[userId] && directRooms[userId].length > 0) {
        const roomId = directRooms[userId][0];
        if (client.getRoom(roomId)) {
            return roomId;
        }
    }

    // Alternative check: find a room with only us as a member
    const rooms = client.getRooms();
    for (const room of rooms) {
        if (room.getJoinedMemberCount() === 1 && room.getMember(userId)) {
            const updatedDirectRooms = { ...directRooms, [userId]: [room.roomId] };
            // FIX: The type 'm.direct' is not present in the SDK's AccountDataEvents type definitions.
            // Casting to `any` bypasses this strict type check for a valid, but untyped, event.
            // FIX: The content is cast to 'any' because the SDK's incomplete typings cause TypeScript to infer an incorrect type for the `setAccountData` content argument when the event type is 'any'.
            await client.setAccountData('m.direct' as any, updatedDirectRooms as any);
            return room.roomId;
        }
    }

    // If no room is found, create a new one
    console.log("No Saved Messages room found, creating one...");
    const { room_id: newRoomId } = await client.createRoom({
        visibility: Visibility.Private,
        is_direct: true,
        // No need to invite self, createRoom adds creator to the room
    });
    
    // Update m.direct account data
    const updatedDirectRooms = { ...directRooms, [userId]: [newRoomId] };
    // FIX: The type 'm.direct' is not present in the SDK's AccountDataEvents type definitions.
    // Casting to `any` bypasses this strict type check for a valid, but untyped, event.
    // FIX: The content is cast to 'any' because the SDK's incomplete typings cause TypeScript to infer an incorrect type for the `setAccountData` content argument when the event type is 'any'.
    await client.setAccountData('m.direct' as any, updatedDirectRooms as any);
    
    console.log(`Created and registered Saved Messages room: ${newRoomId}`);
    return newRoomId;
};


export const mxcToHttp = (client: MatrixClient, mxcUrl: string | null | undefined, size?: number): string | null => {
    if (!mxcUrl || !mxcUrl.startsWith('mxc://')) {
        return mxcUrl || null;
    }
    try {
        if (size) {
            return client.mxcUrlToHttp(mxcUrl, size, size, 'scale', true);
        }
        return client.mxcUrlToHttp(mxcUrl);
    } catch (e) {
        console.error("Failed to convert mxc URL:", e);
        return null;
    }
};

const URL_REGEX = /(https?:\/\/[^\s]+)/;

export const sendMessage = async (
    client: MatrixClient,
    roomId: string,
    body: string,
    replyToEvent?: MatrixEvent,
    threadRootId?: string,
    roomMembers: MatrixUser[] = []
): Promise<{ event_id: string }> => {
    const mentionedUserIds = new Set<string>();
    const formattedBodyParts: string[] = [];
    const parts = body.split(/(@[a-zA-Z0-9\._-]*)/g);

    parts.forEach(part => {
        if (part.startsWith('@')) {
            const member = roomMembers.find(m => m.displayName === part.substring(1) || m.userId === part);
            if (member) {
                mentionedUserIds.add(member.userId);
                formattedBodyParts.push(`<a href="https://matrix.to/#/${member.userId}">${member.displayName}</a>`);
                return;
            }
        }
        formattedBodyParts.push(part.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    });

    const content: any = {
        msgtype: MsgType.Text,
        body: body,
    };

    if (mentionedUserIds.size > 0) {
        content.format = 'org.matrix.custom.html';
        content.formatted_body = formattedBodyParts.join('');
        content['m.mentions'] = {
            user_ids: Array.from(mentionedUserIds),
        };
    }

    const urlMatch = body.match(URL_REGEX);
    if (urlMatch) {
        try {
            // FIX: The `getUrlPreview` method requires a timestamp as its second argument. Passing `Date.now()` to satisfy this requirement.
            const previewData = await client.getUrlPreview(urlMatch[0], Date.now());
            if (previewData && Object.keys(previewData).length > 0) {
                const imageUrl = previewData['og:image'] ? mxcToHttp(client, previewData['og:image']) : undefined;
                
                content['custom.url_preview'] = {
                    url: previewData['og:url'] || urlMatch[0],
                    image: imageUrl,
                    title: previewData['og:title'],
                    description: previewData['og:description'],
                    siteName: previewData['og:site_name'],
                };
            }
        } catch (e) {
            console.warn("Failed to get URL preview:", e);
        }
    }
    
    if (threadRootId) {
        content['m.relates_to'] = {
            'rel_type': 'm.thread',
            'event_id': threadRootId,
            ...(replyToEvent && {
                "m.in_reply_to": {
                    "event_id": replyToEvent.getId(),
                }
            })
        };
    } else if (replyToEvent) {
        content['m.relates_to'] = {
            "m.in_reply_to": {
                "event_id": replyToEvent.getId(),
            },
        };
    }

    return client.sendEvent(roomId, EventType.RoomMessage, content);
};

export const compressImage = (file: File, maxWidth = 1280): Promise<File> => {
    if (!file.type.startsWith('image/')) {
        return Promise.resolve(file); // Don't compress non-images
    }

    return new Promise((resolve, reject) => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);
            if (img.width <= maxWidth) {
                return resolve(file); // Don't upscale or re-compress if already small enough
            }

            const canvas = document.createElement('canvas');
            const scale = maxWidth / img.width;
            canvas.width = maxWidth;
            canvas.height = img.height * scale;
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Could not get canvas context'));
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        return reject(new Error('Canvas to Blob failed'));
                    }
                    const newFileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
                    const newFile = new File([blob], newFileName, { type: 'image/jpeg', lastModified: Date.now() });
                    resolve(newFile);
                },
                'image/jpeg',
                0.8 // 80% quality
            );
        };
        img.onerror = (error) => {
            URL.revokeObjectURL(img.src);
            reject(error);
        };
    });
};


export const sendImageMessage = async (client: MatrixClient, roomId: string, file: File): Promise<{ event_id: string }> => {
    const compressedFile = await compressImage(file);

    const { content_uri: mxcUrl } = await client.uploadContent(compressedFile, {
        name: compressedFile.name,
        type: compressedFile.type,
    });

    const content = {
        body: compressedFile.name,
        info: {
            mimetype: compressedFile.type,
            size: compressedFile.size,
        },
        msgtype: MsgType.Image,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const sendAudioMessage = async (client: MatrixClient, roomId: string, file: Blob, duration: number): Promise<{ event_id: string }> => {
    const { content_uri: mxcUrl } = await client.uploadContent(file, {
        name: "voice-message.ogg",
        type: file.type,
    });

    const content = {
        body: "Voice Message",
        info: {
            mimetype: file.type,
            size: file.size,
            duration: Math.round(duration * 1000), // duration in milliseconds
        },
        msgtype: MsgType.Audio,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};


export const sendFileMessage = async (client: MatrixClient, roomId: string, file: File): Promise<{ event_id: string }> => {
    const { content_uri: mxcUrl } = await client.uploadContent(file, {
        name: file.name,
        type: file.type,
    });

    const content = {
        body: file.name,
        info: {
            mimetype: file.type,
            size: file.size,
        },
        msgtype: MsgType.File,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const sendStickerMessage = async (client: MatrixClient, roomId: string, stickerUrl: string, body: string, info: Sticker['info']): Promise<{ event_id: string }> => {
    const content = {
        body,
        info,
        url: stickerUrl,
        msgtype: 'm.sticker',
    };
    // The matrix-js-sdk doesn't have m.sticker in its standard event types, so we cast to any.
    return client.sendEvent(roomId, 'm.sticker' as any, content);
};

export const sendGifMessage = async (client: MatrixClient, roomId: string, gif: Gif): Promise<{ event_id: string }> => {
    // We send GIFs as m.image events. We add a custom flag to help our UI distinguish it.
    const { url, title, dims } = gif;
    
    // FIX: The `uploadContentFromUrl` method does not exist on the MatrixClient type.
    // The correct procedure is to fetch the content from the URL, convert it to a Blob,
    // and then upload it using `uploadContent`.
    const response = await fetch(url);
    const blob = await response.blob();
    const { content_uri: mxcUrl } = await client.uploadContent(blob, {
        name: title,
        type: 'image/gif',
    });

    const content = {
        body: title,
        info: {
            mimetype: 'image/gif',
            w: dims[0],
            h: dims[1],
            'xyz.amorgan.is_gif': true,
        },
        msgtype: MsgType.Image,
        url: mxcUrl,
    };

    return client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const sendReaction = async (client: MatrixClient, roomId: string, eventId: string, emoji: string): Promise<void> => {
    const content = {
        'm.relates_to': {
            'rel_type': RelationType.Annotation,
            'event_id': eventId,
            'key': emoji,
        },
    };
    await client.sendEvent(roomId, EventType.Reaction, content as any);
};

export const sendTypingIndicator = async (client: MatrixClient, roomId: string, isTyping: boolean): Promise<void> => {
    try {
        await client.sendTyping(roomId, isTyping, 6000);
    } catch (error) {
        console.error("Failed to send typing indicator:", error);
    }
};

export const editMessage = async (client: MatrixClient, roomId: string, eventId: string, newBody: string): Promise<void> => {
    const content = {
        'body': `* ${newBody}`,
        'msgtype': MsgType.Text,
        'm.new_content': {
            'body': newBody,
            'msgtype': MsgType.Text,
        },
        'm.relates_to': {
            'rel_type': RelationType.Replace,
            'event_id': eventId,
        },
    };
    await client.sendEvent(roomId, EventType.RoomMessage, content as any);
};

export const deleteMessage = async (client: MatrixClient, roomId: string, eventId: string): Promise<void> => {
    try {
        await client.redactEvent(roomId, eventId);
    } catch (error)
        {
        console.error("Failed to delete message:", error);
    }
};

export const forwardMessage = async (client: MatrixClient, targetRoomId: string, originalEvent: MatrixEvent): Promise<{ event_id: string }> => {
    const originalContent = originalEvent.getContent();
    const newContent = { ...originalContent };

    // Remove relation to not make it a reply in the new room
    delete newContent['m.relates_to'];

    if (originalContent.msgtype === MsgType.Text) {
        const senderDisplayName = originalEvent.sender?.name || originalEvent.getSender();
        newContent.body = `Forwarded message from ${senderDisplayName}:\n${originalContent.body}`;
        if (originalContent.formatted_body) {
            newContent.formatted_body = `<blockquote><p>Forwarded message from ${senderDisplayName}:</p>${originalContent.formatted_body}</blockquote>`;
        }
    }

    // FIX: The `getType()` method returns a generic `string`, which is not assignable to the
    // specific event type keys expected by `sendEvent`. Casting to `any` bypasses this
    // strict type check.
    return client.sendEvent(targetRoomId, originalEvent.getType() as any, newContent);
};

export const sendReadReceipt = async (client: MatrixClient, roomId: string, eventId: string): Promise<void> => {
    try {
        const room = client.getRoom(roomId);
        const event = room?.findEventById(eventId);
        if (event) {
            await client.sendReadReceipt(event);
        } else {
            console.warn(`Could not find event ${eventId} in room ${roomId} to mark as read.`);
        }
    } catch (error) {
        console.error("Failed to send read receipt:", error);
    }
};

export const setDisplayName = async (client: MatrixClient, newName: string): Promise<void> => {
    try {
        await client.setDisplayName(newName);
    } catch (error) {
        console.error("Failed to set display name:", error);
        throw error;
    }
};

export const setAvatar = async (client: MatrixClient, file: File): Promise<void> => {
    try {
        const { content_uri: mxcUrl } = await client.uploadContent(file, {
            name: file.name,
            type: file.type,
        });
        await client.setAvatarUrl(mxcUrl);
    } catch (error) {
        console.error("Failed to set avatar:", error);
        throw error;
    }
};

export const createRoom = async (client: MatrixClient, options: { name: string, topic?: string, isPublic: boolean, isEncrypted: boolean }): Promise<string> => {
    try {
        // FIX: Replaced `RoomCreateOptions` with the correct type `ICreateRoomOpts`.
        const createOptions: ICreateRoomOpts = {
            name: options.name,
            topic: options.topic,
            // FIX: Use Visibility enum instead of string literals for type safety.
            visibility: options.isPublic ? Visibility.Public : Visibility.Private,
        };
        if (options.isEncrypted) {
            createOptions.initial_state = [
                {
                    // FIX: This is a typing issue in the matrix-js-sdk where `m.room.encryption` is not
                    // considered a valid key of `TimelineEvents`. Using @ts-ignore is a safe workaround
                    // to bypass this strict compiler check for state events.
                    // @ts-ignore
                    type: EventType.RoomEncryption,
                    state_key: "",
                    content: {
                        algorithm: "m.megolm.v1.aes-sha2",
                    },
                },
            ];
        }
        const { room_id } = await client.createRoom(createOptions);
        return room_id;
    } catch(error) {
        console.error("Failed to create room:", error);
        throw error;
    }
};

export const inviteUser = async (client: MatrixClient, roomId: string, userId: string): Promise<void> => {
    try {
        await client.invite(roomId, userId);
    } catch (error) {
        console.error(`Failed to invite ${userId} to ${roomId}:`, error);
        throw error; // Re-throw to be handled by the UI
    }
};

export const setPinnedMessages = async (client: MatrixClient, roomId: string, eventIds: string[]): Promise<void> => {
    try {
        // FIX: The matrix-js-sdk has an incomplete typing for state events, not including m.room.pinned_events
        // in the expected enum. Using @ts-ignore to bypass this check.
        // @ts-ignore
        await client.sendStateEvent(roomId, EventType.RoomPinnedEvents, { pinned: eventIds }, "");
    } catch (error) {
        console.error("Failed to set pinned messages:", error);
        throw error;
    }
};

export const paginateRoomHistory = async (client: MatrixClient, room: MatrixRoom, limit = 30): Promise<boolean> => {
    if (!room) return false;
    try {
        const eventsPaginated = await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit });
        return eventsPaginated;
    } catch (error) {
        console.error("Failed to paginate room history:", error);
        return false;
    }
};

export const sendPollStart = async (client: MatrixClient, roomId: string, question: string, options: string[]): Promise<{ event_id: string }> => {
    const answers = options.map((opt, i) => ({
        id: `option_${i}_${Date.now()}`,
        'org.matrix.msc1767.text': opt,
    }));
    
    const content = {
        'org.matrix.msc1767.text': `[POLL] ${question}`,
        'm.poll.start': { // Using stable prefix
            question: {
                'org.matrix.msc1767.text': question
            },
            answers: answers,
        },
        "msgtype": "m.text"
    };
    
    // FIX: Cast custom event type to `any` to bypass strict SDK type checks.
    // Using custom event type as it might not be in the SDK's EventType enum
    return client.sendEvent(roomId, 'm.poll.start' as any, content);
};

export const sendPollResponse = async (client: MatrixClient, roomId: string, pollStartEventId: string, answerId: string): Promise<{ event_id: string }> => {
    const content = {
        'm.relates_to': {
            'rel_type': 'm.reference',
            'event_id': pollStartEventId
        },
        'm.poll.response': { // Using stable prefix
            answers: [answerId]
        }
    };
    // FIX: Cast custom event type to `any` to bypass strict SDK type checks.
    // Using custom event type as it might not be in the SDK's EventType enum
    return client.sendEvent(roomId, 'm.poll.response' as any, content);
};

export const translateText = async (text: string): Promise<string> => {
    try {
        const targetLanguage = navigator.language;

        const response = await fetch(TRANSLATION_SERVER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text,
                target_lang: targetLanguage,
            }),
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Translation server returned an error: ${response.status} ${errorBody}`);
        }

        const data = await response.json();
        
        if (!data.translated_text) {
             throw new Error("Invalid response format from translation server. Expected 'translated_text' key.");
        }

        return data.translated_text;

    } catch (error) {
        console.error("Error translating text with custom server:", error);
        return "Translation failed.";
    }
};
import { MatrixClient, MatrixEvent, MatrixRoom, MatrixUser, Sticker, Gif } from '../types';
// FIX: `RoomCreateOptions` is not an exported member of `matrix-js-sdk`. Replaced with the correct type `ICreateRoomOpts`.
// FIX: Import Visibility enum to correctly type room creation options.
import {
    createClient,
    ICreateClientOpts,
    EventType,
    MsgType,
    RelationType,
    ICreateRoomOpts,
    Visibility,
    AutoDiscovery,
    AutoDiscoveryAction,
    AutoDiscoveryError,
} from 'matrix-js-sdk';

// *** ВАЖНО: Укажите здесь URL вашего сервера для перевода ***
const TRANSLATION_SERVER_URL = 'https://your-translation-server.com/api/translate';

const secureCloudProfiles = new WeakMap<MatrixClient, SecureCloudProfile>();

export const setSecureCloudProfileForClient = (client: MatrixClient, profile: SecureCloudProfile | null): void => {
    if (!profile || profile.mode === 'disabled') {
        secureCloudProfiles.delete(client);
        return;
    }
    secureCloudProfiles.set(client, profile);
};

export const getSecureCloudProfileForClient = (client: MatrixClient): SecureCloudProfile | null => {
    return secureCloudProfiles.get(client) ?? null;
};


export class HomeserverDiscoveryError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'HomeserverDiscoveryError';
    }
}

const MATRIX_ID_DOMAIN_PATTERN = /^@[^:]+:(.+)$/;

const normalizeBaseUrl = (value: string): string => {
    const ensureProtocol = (url: string) => (url.includes('://') ? url : `https://${url}`);
    let candidate = ensureProtocol(value);

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'https:') {
            parsed.protocol = 'https:';
        }
        parsed.hash = '';
        parsed.search = '';
        // remove trailing slash for consistency but keep non-root paths intact
        const normalised = parsed.toString();
        return normalised.endsWith('/') && parsed.pathname === '/' ? normalised.slice(0, -1) : normalised;
    } catch (error) {
        throw new HomeserverDiscoveryError('Сервер вернул некорректный адрес homeserver.');
    }
};

const formatDiscoveryErrorMessage = (error?: AutoDiscoveryError | null): string => {
    switch (error) {
        case AutoDiscovery.ERROR_MISSING_WELLKNOWN:
            return 'На сервере отсутствует /.well-known/matrix/client.';
        case AutoDiscovery.ERROR_INVALID_HOMESERVER:
            return 'Указанный сервер не поддерживает Matrix.';
        case AutoDiscovery.ERROR_INVALID_HS_BASE_URL:
        case AutoDiscovery.ERROR_INVALID:
            return 'Сервер вернул некорректные настройки discovery.';
        case AutoDiscovery.ERROR_GENERIC_FAILURE:
            return 'Не удалось получить настройки discovery с сервера.';
        default:
            return 'Не удалось определить адрес homeserver.';
    }
};

export const resolveHomeserverBaseUrl = async (input: string): Promise<string> => {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new HomeserverDiscoveryError('Укажите домен, Matrix ID или URL homeserver.');
    }

    const matrixIdMatch = trimmed.match(MATRIX_ID_DOMAIN_PATTERN);
    const withoutMatrixId = matrixIdMatch ? matrixIdMatch[1] : trimmed;

    const stripProtocol = withoutMatrixId.replace(/^https?:\/\//i, '');
    const discoveryTarget = stripProtocol.split('/')[0];

    if (!discoveryTarget) {
        throw new HomeserverDiscoveryError('Некорректный адрес homeserver.');
    }

    let discoveryResult;
    try {
        discoveryResult = await AutoDiscovery.findClientConfig(discoveryTarget);
    } catch (error) {
        throw new HomeserverDiscoveryError('Не удалось выполнить discovery для указанного сервера.');
    }

    const homeserverConfig = discoveryResult['m.homeserver'];
    if (
        !homeserverConfig ||
        homeserverConfig.state !== AutoDiscoveryAction.SUCCESS ||
        !homeserverConfig.base_url
    ) {
        throw new HomeserverDiscoveryError(formatDiscoveryErrorMessage(homeserverConfig?.error));
    }

    return normalizeBaseUrl(homeserverConfig.base_url);
};


export const initClient = (homeserverUrl: string, accessToken?: string, userId?: string): MatrixClient => {
    const options: ICreateClientOpts = {
        baseUrl: homeserverUrl,
    };
    if (accessToken && userId) {
        options.accessToken = accessToken;
        options.userId = userId;
    }
    return createClient(options);
};

export const login = async (
    homeserverUrl: string,
    username: string,
    password: string,
    secureProfile?: SecureCloudProfile,
): Promise<MatrixClient> => {
    const client = initClient(homeserverUrl);
    await client.loginWithPassword(username, password);
    await client.startClient({ initialSyncLimit: 10 });
    if (secureProfile) {
        setSecureCloudProfileForClient(client, secureProfile);
    }
    return client;
};

export const register = async (homeserverUrl: string, username: string, password: string): Promise<MatrixClient> => {
    const client = initClient(homeserverUrl);
    let sessionId: string | null = null;
    let hasAttemptedDummy = false;
    let registerResponse: Awaited<ReturnType<typeof client.register>> | null = null;

    while (true) {
        try {
            registerResponse = await client.register(
                username,
                password,
                sessionId,
                sessionId ? { type: "m.login.dummy", session: sessionId } : { type: "m.login.dummy" },
                undefined,
                undefined,
                true,
            );
            break;
        } catch (error: any) {
            const matrixError = error ?? {};
            const flows: Array<{ stages?: string[] }> = Array.isArray(matrixError?.data?.flows)
                ? matrixError.data.flows
                : [];
            const stages = flows.flatMap((flow) => flow.stages ?? []);

            if (!hasAttemptedDummy && matrixError?.data?.session && flows.length > 0) {
                if (stages.every((stage) => stage === "m.login.dummy") && stages.includes("m.login.dummy")) {
                    sessionId = matrixError.data.session;
                    hasAttemptedDummy = true;
                    continue;
                }

                if (stages.includes("m.login.recaptcha")) {
                    throw new Error(
                        "Сервер требует прохождения капчи. Откройте официальный клиент или веб-интерфейс homeserver'а, чтобы завершить регистрацию.",
                    );
                }

                if (stages.includes("m.login.email.identity")) {
                    throw new Error(
                        "Сервер требует подтверждение email. Завершите регистрацию через официальный клиент и повторите попытку входа.",
                    );
                }

                throw new Error(
                    "Сервер требует дополнительные шаги регистрации, которые пока не поддерживаются. Используйте официальный клиент homeserver'а.",
                );
            }

            if (matrixError?.errcode === "M_USER_IN_USE") {
                throw new Error("Имя пользователя уже занято. Попробуйте другой логин.");
            }

            if (matrixError?.errcode === "M_INVALID_USERNAME") {
                throw new Error("Некорректный логин. Используйте только латиницу, цифры и символы -_.");
            }

            if (matrixError?.errcode === "M_WEAK_PASSWORD") {
                throw new Error("Пароль слишком простой. Добавьте буквы разного регистра, цифры и символы.");
            }

            if (matrixError?.errcode === "M_FORBIDDEN") {
                const rawMessage = (matrixError?.data?.error || matrixError?.message || "").toLowerCase();
                if (rawMessage.includes("registration") && rawMessage.includes("disabled")) {
                    throw new Error(
                        "Регистрация отключена на этом сервере. Свяжитесь с администратором или выберите другой homeserver.",
                    );
                }
            }

            throw new Error(matrixError?.data?.error || matrixError?.message || "Регистрация не удалась.");
        }
    }

    const userId = registerResponse?.user_id || username;
    return login(homeserverUrl, userId, password);
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

// ========= Group Calls & Screen Share helpers =========
// Simple bridge to external SFU (Jitsi/LiveKit) and MSC3401-compatible notice
export type SfuKind = 'jitsi' | 'livekit' | 'other';

export interface StartGroupCallOptions {
  sfuBaseUrl?: string;        // e.g. https://call.example.com
  sfuKind?: SfuKind;          // 'jitsi' | 'livekit'
  topic?: string;             // optional display topic
  openIn?: 'webview' | 'browser';
}

/**
 * Create a group call URL and announce it into the room.
 * Sends m.notice with {"org.matrix.call.group": { url, kind }}.
 * Falls back to `${sfuBaseUrl}/room/<roomId>?user=<userId>`.
 */
export async function startGroupCall(client: MatrixClient, roomId: string, opts: StartGroupCallOptions = {}): Promise<{ url: string }> {
  const userId = client.getUserId() || 'unknown';
  const sfuBase = opts.sfuBaseUrl || (typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_SFU_BASE_URL : undefined);
  if (!sfuBase) {
    throw new Error('SFU base URL is not configured. Set VITE_SFU_BASE_URL or pass opts.sfuBaseUrl');
  }
  const url = `${sfuBase.replace(/\/+$/, '')}/room/${encodeURIComponent(roomId)}?user=${encodeURIComponent(userId)}`;
  const content: any = {
    msgtype: 'm.notice',
    body: opts.topic ? `Group call: ${opts.topic}` : 'Group call started',
    'org.matrix.call.group': { url, kind: opts.sfuKind || 'other' },
  };
  await client.sendEvent(roomId, 'm.room.message', content);
  return { url };
}

/**
 * Join a group call by opening an internal Tauri WebView window if available, otherwise a browser tab.
 */
export async function joinGroupCall(roomId: string, url: string, title = 'Group Call'): Promise<void> {
  try {
    // Tauri 2.x global marker
    if (typeof (window as any).__TAURI__ !== 'undefined') {
      const windowApi = await import('@tauri-apps/api/window');
      const WebviewWindow = (windowApi as any).WebviewWindow;
      if (WebviewWindow) {
        const win = new WebviewWindow(`call-${Date.now()}`, { title, url });
        await win.setFocus();
        return;
      }
      console.warn('Tauri WebviewWindow API не найдена, fallback на браузер.');
    }
  } catch (_) {
    // ignore and fallback
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Wrapper for screen capture.
 */
export async function getDisplayMedia(constraints: DisplayMediaStreamOptions = { video: { frameRate: 15 } }): Promise<MediaStream> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error('Screen share is not supported in this environment');
  }
  return await navigator.mediaDevices.getDisplayMedia(constraints);
}

/**
 * Enumerate media devices.
 */
export async function enumerateDevices(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  return await navigator.mediaDevices.enumerateDevices();
}

/**
 * Swap video track on a given MediaStream in-place.
 */
export function swapVideoTrack(stream: MediaStream, newTrack: MediaStreamTrack): MediaStream {
  const old = stream.getVideoTracks()[0];
  if (old) {
    stream.removeTrack(old);
    old.stop();
  }
  stream.addTrack(newTrack);
  return stream;
}

// ========= TTL (Time To Live) Message Management =========
// In-memory storage for per-room TTL settings and next message TTL
const roomTTLCache = new Map<string, number | null>();
const nextMessageTTLCache = new Map<string, number | null>();

/**
 * Get the default TTL for a room (in milliseconds).
 * Returns null if no TTL is set.
 */
export async function getRoomTTL(client: MatrixClient, roomId: string): Promise<number | null> {
  try {
    // Check cache first
    if (roomTTLCache.has(roomId)) {
      return roomTTLCache.get(roomId) || null;
    }

    // Try to get from room account data or state event
    const room = client.getRoom(roomId);
    if (!room) return null;

    // FIX: Room account data access may not be fully typed. Cast to any if needed.
    const accountData = room.getAccountData('m.room.ttl' as any);
    if (accountData) {
      const ttl = accountData.getContent()?.ttl;
      roomTTLCache.set(roomId, ttl || null);
      return ttl || null;
    }

    return null;
  } catch (error) {
    console.error('Failed to get room TTL:', error);
    return null;
  }
}

/**
 * Set the default TTL for a room (in milliseconds).
 * Pass null to disable TTL.
 */
export async function setRoomTTL(client: MatrixClient, roomId: string, ttlMs: number | null): Promise<void> {
  try {
    const room = client.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    // Store in room account data
    // FIX: Room account data types may be incomplete. Cast to any.
    await client.setRoomAccountData(roomId, 'm.room.ttl' as any, {
      ttl: ttlMs,
    });

    // Update cache
    roomTTLCache.set(roomId, ttlMs);
  } catch (error) {
    console.error('Failed to set room TTL:', error);
    throw error;
  }
}

/**
 * Set TTL for the next message only (in milliseconds).
 * This is stored in memory and applied to the next sent message.
 */
export function setNextMessageTTL(roomId: string, ttlMs: number | null): void {
  nextMessageTTLCache.set(roomId, ttlMs);
}

/**
 * Get the TTL set for the next message (in milliseconds).
 * Returns null if no TTL is set.
 */
export function getNextMessageTTL(roomId: string): number | null {
  return nextMessageTTLCache.get(roomId) || null;
}

/**
 * Clear the next message TTL after sending.
 */
export function clearNextMessageTTL(roomId: string): void {
  nextMessageTTLCache.delete(roomId);
}

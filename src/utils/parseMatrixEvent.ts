import { MatrixClient, MatrixEvent, Message, Reaction, Poll, PollResult, ReplyInfo, LinkPreviewData } from '../types';
import { EventType, RelationType } from 'matrix-js-sdk';
import { mxcToHttp } from '../services/matrixService';
import { buildExternalNavigationUrl, MAP_ZOOM_DEFAULT, parseGeoUri, sanitizeZoom } from './location';

export function parseMatrixEvent(client: MatrixClient, event: MatrixEvent): Message {
    const sender = event.sender;
    const roomId = event.getRoomId();
    const room = roomId ? client.getRoom(roomId) : null;

    const aggregatedReactions: Record<string, Reaction> = {};
    if (room) {
        const reactionEvents = (room as any).getRelatedEventsForEvent?.(
            event.getId()!,
            RelationType.Annotation,
            EventType.Reaction,
        );
        if (reactionEvents) {
            reactionEvents.forEach((reactionEvent: MatrixEvent) => {
                if (reactionEvent.isRedacted()) return;
                const key = reactionEvent.getRelation()?.key;
                if (!key) return;
                if (!aggregatedReactions[key]) {
                    aggregatedReactions[key] = { count: 0, isOwn: false };
                }
                aggregatedReactions[key].count++;
                if (reactionEvent.getSender() === client.getUserId()) {
                    aggregatedReactions[key].isOwn = true;
                    aggregatedReactions[key].ownEventId = reactionEvent.getId();
                }
            });
        }
    }

    let pollData: Poll | undefined = undefined;
    const pollStartContent = event.getContent()['m.poll.start'];

    if (event.getType() === 'm.poll.start' && pollStartContent) {
        const options = pollStartContent.answers.map((ans: any) => ({
            id: ans.id,
            text: ans['org.matrix.msc1767.text'],
        }));

        const results: Record<string, PollResult> = {};
        options.forEach((opt: { id: string }) => {
            results[opt.id] = { votes: 0 };
        });

        let userVote: string | undefined = undefined;

        if (room) {
            const responseEvents = (room as any).getRelatedEventsForEvent?.(
                event.getId()!,
                'm.reference',
                'm.poll.response',
            );
            const userVotes: Record<string, string> = {};

            if (responseEvents) {
                responseEvents.forEach((resEvent: MatrixEvent) => {
                    const senderId = resEvent.getSender();
                    const answerIds = resEvent.getContent()['m.poll.response']?.answers;
                    if (senderId && answerIds && Array.isArray(answerIds) && answerIds.length > 0) {
                        userVotes[senderId] = answerIds[0];
                    }
                });
            }

            Object.values(userVotes).forEach(voteId => {
                if (results[voteId]) {
                    results[voteId].votes++;
                }
            });

            userVote = userVotes[client.getUserId()!];
        }

        pollData = {
            question: pollStartContent.question['org.matrix.msc1767.text'],
            options,
            results,
            userVote,
        };
    }

    const replacementEvent = event.replacingEvent();
    const content = event.isRedacted()
        ? { body: 'Message deleted', msgtype: 'm.text' }
        : (replacementEvent ? replacementEvent.getContent() : event.getContent());

    const replyEventId = event.replyEventId;
    let replyTo: ReplyInfo | null = null;
    if (replyEventId && room) {
        const repliedToEvent = room.findEventById(replyEventId);
        if (repliedToEvent) {
            replyTo = {
                sender: repliedToEvent.sender?.name || 'Unknown User',
                body: repliedToEvent.getContent().body,
            };
        }
    }

    const readBy: Message['readBy'] = {};
    if (room) {
        room.getUsersReadUpTo(event).forEach(userId => {
            const receipt = room.getReadReceiptForUserId(userId);
            if (receipt) {
                readBy[userId] = { ts: receipt.data.ts };
            }
        });
    }

    const threadInfo = event.getThread();
    const threadReplyCount = threadInfo ? threadInfo.length : 0;
    const relation = event.getRelation();
    const threadRootId = relation?.rel_type === 'm.thread' ? relation.event_id : undefined;

    const previewDataRaw = content['custom.url_preview'];
    let linkPreview: LinkPreviewData | undefined = undefined;
    if (previewDataRaw) {
        linkPreview = {
            url: previewDataRaw.url,
            image: previewDataRaw.image,
            title: previewDataRaw.title,
            description: previewDataRaw.description,
            siteName: previewDataRaw.siteName,
        };
    }

    const isSticker = event.getType() === 'm.sticker';
    const isGif = content.msgtype === 'm.image' && content.info?.['xyz.amorgan.is_gif'];

    let location: Message['location'] = null;
    if (content.msgtype === 'm.location') {
        const geoUri = typeof content.geo_uri === 'string'
            ? content.geo_uri
            : (typeof content?.['m.location']?.uri === 'string' ? content['m.location'].uri : null);
        const parsedGeo = parseGeoUri(geoUri);
        if (parsedGeo) {
            const zoomValue = sanitizeZoom((content as any)?.['com.matrix_messenger.map_zoom']);
            const thumbnailUrlRaw = content?.info?.thumbnail_url
                || content?.info?.thumbnail_file?.url
                || null;
            const thumbnailUrl = thumbnailUrlRaw ? mxcToHttp(client, thumbnailUrlRaw, 512) : null;
            const externalUrl = typeof content?.external_url === 'string'
                ? content.external_url
                : buildExternalNavigationUrl(parsedGeo.latitude, parsedGeo.longitude, zoomValue ?? MAP_ZOOM_DEFAULT);
            location = {
                latitude: parsedGeo.latitude,
                longitude: parsedGeo.longitude,
                accuracy: parsedGeo.accuracy,
                description: typeof content.body === 'string' ? content.body : undefined,
                zoom: zoomValue,
                geoUri: geoUri ?? '',
                externalUrl,
                thumbnailUrl,
            };
        }
    }

    const destructContent = content['com.matrix_messenger.self_destruct'];
    let selfDestruct: Message['selfDestruct'] = null;
    if (destructContent && typeof destructContent === 'object') {
        const ttlMs = typeof destructContent.ttlMs === 'number' ? destructContent.ttlMs : undefined;
        const expiresAtRaw = destructContent.expiresAt ?? (ttlMs ? event.getTs() + ttlMs : null);
        if (typeof expiresAtRaw === 'number' && Number.isFinite(expiresAtRaw)) {
            selfDestruct = {
                expiresAt: expiresAtRaw,
                ttlMs,
            };
        }
    }

    let transcript = null;
    const eventId = event.getId();
    if (eventId && room) {
        const related = (room as any).getRelatedEventsForEvent?.(eventId, RelationType.Annotation, EventType.RoomMessage) as MatrixEvent[] | undefined;
        transcript = pickLatestTranscript(related);
    }

    return {
        id: event.getId()!,
        sender: {
            id: sender?.userId || 'unknown',
            name: sender?.name || 'Unknown User',
            avatarUrl: sender ? mxcToHttp(client, sender.getMxcAvatarUrl()) : null,
        },
        content: {
            ...content,
            body: content.body || (pollData ? pollData.question : ''),
            msgtype: content.msgtype || 'm.text',
        },
        timestamp: event.getTs(),
        isOwn: sender?.userId === client.getUserId(),
        reactions: Object.keys(aggregatedReactions).length > 0 ? aggregatedReactions : null,
        isEdited: !!event.replacingEventId(),
        isRedacted: event.isRedacted(),
        replyTo,
        readBy,
        threadReplyCount,
        threadRootId,
        poll: pollData,
        rawEvent: event,
        linkPreview,
        isSticker,
        isGif,
        selfDestruct,
        location,
    };
}

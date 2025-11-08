import { MatrixClient, MatrixEvent, Message, Reaction, Poll, PollResult, ReplyInfo, LinkPreviewData } from '../types';
import { EventType, RelationType } from 'matrix-js-sdk';
import { mxcToHttp } from '../services/matrixService';

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
    };
}

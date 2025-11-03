import React, { useState, useEffect, useCallback, useRef } from 'react';
// FIX: Import MatrixRoom to correctly type room objects from the SDK.
import { Room as UIRoom, Message, MatrixEvent, Reaction, ReplyInfo, MatrixClient, MatrixRoom, ActiveThread, MatrixUser, Poll, PollResult, Folder, ScheduledMessage, MatrixCall, LinkPreviewData, Sticker, Gif } from '../types';
import RoomList from './RoomList';
import MessageView from './MessageView';
import ChatHeader from './ChatHeader';
import MessageInput from './MessageInput';
import { mxcToHttp, sendReaction, sendTypingIndicator, editMessage, sendMessage, deleteMessage, sendImageMessage, sendReadReceipt, sendFileMessage, setDisplayName, setAvatar, createRoom, inviteUser, forwardMessage, paginateRoomHistory, sendAudioMessage, setPinnedMessages, sendPollStart, sendPollResponse, translateText, sendStickerMessage, sendGifMessage } from '../services/matrixService';
import { getScheduledMessages, addScheduledMessage, deleteScheduledMessage } from '../services/schedulerService';
import { checkPermission, sendNotification, setupNotificationListeners } from '../services/notificationService';
import WelcomeView from './WelcomeView';
import SettingsModal from './SettingsModal';
import CreateRoomModal from './CreateRoomModal';
import InviteUserModal from './InviteUserModal';
import ForwardMessageModal from './ForwardMessageModal';
import ImageViewerModal from './ImageViewerModal';
import ThreadView from './ThreadView';
import CreatePollModal from './CreatePollModal';
import ManageFoldersModal from './ManageFoldersModal';
import ScheduleMessageModal from './ScheduleMessageModal';
import ViewScheduledMessagesModal from './ViewScheduledMessagesModal';
import IncomingCallModal from './IncomingCallModal';
import CallView from './CallView';
// FIX: The `matrix-js-sdk` exports event names as enums. Import them to use with the event emitter.
// FIX: Import event enums to use with the event emitter instead of string literals, which are not assignable.
// FIX: `CallErrorCode` is not an exported member of `matrix-js-sdk`. It has been removed.
import { NotificationCountType, EventType, MsgType, ClientEvent, RoomEvent, UserEvent, RelationType, CallEvent } from 'matrix-js-sdk';

interface ChatPageProps {
    client: MatrixClient;
    onLogout: () => void;
    savedMessagesRoomId: string;
}

const ChatPage: React.FC<ChatPageProps> = ({ client, onLogout, savedMessagesRoomId }) => {
    const [rooms, setRooms] = useState<UIRoom[]>([]);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const [typingUsers, setTypingUsers] = useState<string[]>([]);
    const [replyingTo, setReplyingTo] = useState<Message | null>(null);
    const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
    const [viewingImageUrl, setViewingImageUrl] = useState<string | null>(null);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isCreateRoomOpen, setIsCreateRoomOpen] = useState(false);
    const [isInviteUserOpen, setIsInviteUserOpen] = useState(false);
    const [isCreatePollOpen, setIsCreatePollOpen] = useState(false);
    const [pollThreadRootId, setPollThreadRootId] = useState<string | undefined>(undefined);
    const [isManageFoldersOpen, setIsManageFoldersOpen] = useState(false);
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [isViewScheduledModalOpen, setIsViewScheduledModalOpen] = useState(false);
    const [contentToSchedule, setContentToSchedule] = useState('');
    const [scheduleThreadRootId, setScheduleThreadRootId] = useState<string | undefined>(undefined);
    const [allScheduledMessages, setAllScheduledMessages] = useState<ScheduledMessage[]>([]);
    const [userProfileVersion, setUserProfileVersion] = useState(0); // Used to force-refresh components
    const [isPaginating, setIsPaginating] = useState(false);
    const [canPaginate, setCanPaginate] = useState(true);
    const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);
    const [roomMembers, setRoomMembers] = useState<MatrixUser[]>([]);
    const [pinnedMessage, setPinnedMessage] = useState<Message | null>(null);
    const [pinnedEventIds, setPinnedEventIds] = useState<string[]>([]);
    const [canPin, setCanPin] = useState(false);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<string>('all');
    const [activeCall, setActiveCall] = useState<MatrixCall | null>(null);
    const [incomingCall, setIncomingCall] = useState<MatrixCall | null>(null);
    const [translatedMessages, setTranslatedMessages] = useState<Record<string, { text: string; isLoading: boolean }>>({});
    const [chatBackground, setChatBackground] = useState<string>('');
    const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
        return localStorage.getItem('matrix-notifications-enabled') === 'true';
    });
    
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const oldScrollHeightRef = useRef<number>(0);

    // Handle notification settings
    useEffect(() => {
        localStorage.setItem('matrix-notifications-enabled', String(notificationsEnabled));
        if (notificationsEnabled) {
            checkPermission();
        }
    }, [notificationsEnabled]);

    // Setup notification listeners on mount
    useEffect(() => {
        setupNotificationListeners();
    }, []);

    // Load scheduled messages on startup
    useEffect(() => {
        setAllScheduledMessages(getScheduledMessages());
    }, []);

    // Load chat background on startup
    useEffect(() => {
        const savedBg = localStorage.getItem('matrix-chat-bg');
        if (savedBg) {
            setChatBackground(savedBg);
        }
    }, []);

    const handleSetChatBackground = (bgUrl: string) => {
        setChatBackground(bgUrl);
        localStorage.setItem('matrix-chat-bg', bgUrl);
    };

    const handleResetChatBackground = () => {
        setChatBackground('');
        localStorage.removeItem('matrix-chat-bg');
    };

    // Scheduler check loop
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            const dueMessages = getScheduledMessages().filter(m => m.sendAt <= now);

            if (dueMessages.length > 0) {
                dueMessages.forEach(async msg => {
                    try {
                        console.log(`Sending scheduled message ${msg.id} to room ${msg.roomId}`);
                        await sendMessage(client, msg.roomId, msg.content, undefined, msg.threadRootId);
                        deleteScheduledMessage(msg.id);
                    } catch (error) {
                        console.error(`Failed to send scheduled message ${msg.id}:`, error);
                    }
                });
                // Refresh state after sending/deleting
                setAllScheduledMessages(getScheduledMessages());
            }
        }, 5000); // Check every 5 seconds

        return () => clearInterval(interval);
    }, [client]);


    useEffect(() => {
        try {
            const storedFolders = localStorage.getItem('matrix-folders');
            if (storedFolders) {
                setFolders(JSON.parse(storedFolders));
            }
        } catch (e) {
            console.error("Failed to load folders from localStorage", e);
            setFolders([]);
        }
    }, []);

     useEffect(() => {
        if (activeFolderId === 'all' || !selectedRoomId) return;

        const activeFolder = folders.find(f => f.id === activeFolderId);
        if (activeFolder && !activeFolder.roomIds.includes(selectedRoomId)) {
            setSelectedRoomId(null); // Deselect room if not in current folder
        }
    }, [activeFolderId, folders, selectedRoomId]);

    const handleSaveFolders = (newFolders: Folder[]) => {
        setFolders(newFolders);
        localStorage.setItem('matrix-folders', JSON.stringify(newFolders));
        setIsManageFoldersOpen(false);
    };
    
    const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
        scrollContainerRef.current?.scrollTo({
            top: scrollContainerRef.current.scrollHeight,
            behavior,
        });
    }, []);

    const parseMatrixEvent = useCallback((event: MatrixEvent): Message => {
        const sender = event.sender;
        const roomId = event.getRoomId();
        const room = roomId ? client.getRoom(roomId) : null;
        
        const aggregatedReactions: Record<string, Reaction> = {};
        if (room) {
             // FIX: The method `getRelationsForEvent` is not available on EventTimelineSet in this SDK version.
             // Using `getRelatedEventsForEvent` on the room object as a fallback for fetching reactions.
             // FIX: The method `getRelatedEventsForEvent` exists at runtime but is not in the SDK's Room type definition. Cast to `any` to use it.
             const reactionEvents = (room as any).getRelatedEventsForEvent(event.getId()!, RelationType.Annotation, EventType.Reaction);
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
            options.forEach((opt: {id: string}) => {
                results[opt.id] = { votes: 0 };
            });

            let userVote: string | undefined = undefined;

            if (room) {
                // FIX: The method `getRelatedEventsForEvent` exists at runtime but is not in the SDK's Room type definition. Cast to `any` to use it.
                const responseEvents = (room as any).getRelatedEventsForEvent(event.getId()!, 'm.reference', 'm.poll.response');
                const userVotes: Record<string, string> = {}; // { userId: optionId }

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
                    if(results[voteId]) {
                        results[voteId].votes++;
                    }
                });

                userVote = userVotes[client.getUserId()!];
            }

            pollData = {
                question: pollStartContent.question['org.matrix.msc1767.text'],
                options: options,
                results: results,
                userVote: userVote,
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
                if(receipt) {
                    readBy[userId] = { ts: receipt.data.ts };
                }
            });
        }

        const threadInfo = event.getThread();
        // FIX: The 'Thread' object's `replyCount` property is private. Use `.length` to get the count of replies.
        const threadReplyCount = threadInfo ? threadInfo.length : 0;
        const relation = event.getRelation();
        const threadRootId = (relation?.rel_type === 'm.thread') ? relation.event_id : undefined;

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
    }, [client]);

    const loadRoomMessages = useCallback((roomId: string) => {
        const room = client.getRoom(roomId);
        if (room) {
            const mainTimelineEvents = room.getLiveTimeline().getEvents()
                .filter(event => !event.getRelation() || event.getRelation().rel_type !== 'm.thread');
            setMessages(mainTimelineEvents.map(parseMatrixEvent));
            // FIX: Convert RoomMember[] to User[] to match the state type.
            setRoomMembers(room.getJoinedMembers().map(m => m.user).filter((u): u is MatrixUser => !!u));
        }
    }, [client, parseMatrixEvent]);

    const loadPinnedMessage = useCallback((roomId: string) => {
        const room = client.getRoom(roomId);
        if (!room) return;

        const pinnedEvent = room.currentState.getStateEvents(EventType.RoomPinnedEvents, '');
        const ids = pinnedEvent?.getContent().pinned || [];
        setPinnedEventIds(ids);

        if (ids.length > 0) {
            const latestId = ids[ids.length - 1];
            const latestEvent = room.findEventById(latestId);
            if (latestEvent) {
                setPinnedMessage(parseMatrixEvent(latestEvent));
            } else {
                setPinnedMessage(null);
            }
        } else {
            setPinnedMessage(null);
        }
    }, [client, parseMatrixEvent]);

    useEffect(() => {
        const loadRooms = () => {
            const matrixRooms = client.getRooms();
            const sortedRooms = matrixRooms
                .filter(room => room.getJoinedMemberCount() > 0) // Show all rooms including self-chats
                .sort((a, b) => {
                    const lastEventA = a.timeline[a.timeline.length - 1];
                    const lastEventB = b.timeline[b.timeline.length - 1];
                    return (lastEventB?.getTs() || 0) - (lastEventA?.getTs() || 0);
                });

            let savedMessagesRoom: UIRoom | null = null;
            
            const roomData: UIRoom[] = sortedRooms.map(room => {
                const lastEvent = room.timeline[room.timeline.length - 1];
                const pinnedEvent = room.currentState.getStateEvents(EventType.RoomPinnedEvents, '');
                const uiRoom: UIRoom = {
                    roomId: room.roomId,
                    name: room.name,
                    avatarUrl: mxcToHttp(client, room.getMxcAvatarUrl()),
                    lastMessage: lastEvent ? parseMatrixEvent(lastEvent) : null,
                    unreadCount: room.getUnreadNotificationCount(NotificationCountType.Total),
                    pinnedEvents: pinnedEvent?.getContent().pinned || [],
                    isEncrypted: client.isRoomEncrypted(room.roomId),
                    isDirectMessageRoom: room.getJoinedMemberCount() === 2,
                };

                if (room.roomId === savedMessagesRoomId) {
                    savedMessagesRoom = {
                        ...uiRoom,
                        name: 'Saved Messages',
                        isSavedMessages: true,
                    };
                }
                
                return uiRoom;

            }).filter(r => r.roomId !== savedMessagesRoomId);

            if (savedMessagesRoom) {
                setRooms([savedMessagesRoom, ...roomData]);
            } else {
                setRooms(roomData);
            }
        };

        loadRooms();
        setIsLoading(false);

        const onSync = (state: string) => {
             if (state === 'PREPARED') {
                loadRooms();
                if (selectedRoomId) {
                    loadRoomMessages(selectedRoomId);
                    loadPinnedMessage(selectedRoomId);
                }
             }
        };

        const onRoomStateEvent = (event: MatrixEvent) => {
            if (event.getType() === EventType.RoomPinnedEvents && event.getRoomId() === selectedRoomId) {
                loadPinnedMessage(selectedRoomId);
            }
        };

        const onRoomEvent = (event: MatrixEvent) => {
            const roomId = event.getRoomId();
            if(!roomId) return;

            if (notificationsEnabled && !document.hasFocus() && event.getSender() !== client.getUserId() && (event.getType() === EventType.RoomMessage || event.getType() === 'm.sticker') && !event.isRedacted()) {
                const room = client.getRoom(roomId);
                const senderName = event.sender?.name || 'Unknown User';
                const messageBody = event.getContent().body;
                if (room && room.roomId !== savedMessagesRoomId) { // Do not notify for own saved messages
                    sendNotification(room.name, `${senderName}: ${messageBody}`);
                }
            }
            
            const updateRoomList = setTimeout(() => loadRooms(), 500);

            if (roomId === selectedRoomId) {
                // Handle local echo for own messages
                if ((event.getType() === EventType.RoomMessage || event.getType() === 'm.sticker') && event.getSender() === client.getUserId()) {
                     const txnId = event.getTxnId();
                     if (txnId) {
                         setMessages(prev => prev.filter(m => m.id !== txnId));
                     }
                }
                
                // If a thread is active, update its messages
                if (activeThread) {
                    const relation = event.getRelation();
                    if(relation?.rel_type === 'm.thread' && relation.event_id === activeThread.rootMessage.id) {
                         const room = client.getRoom(roomId);
                         const threadEvents = room?.getThread(activeThread.rootMessage.id)?.events;
                         setActiveThread(prev => prev ? ({
                             ...prev,
                             threadMessages: threadEvents?.map(parseMatrixEvent) || []
                         }) : null);
                    }
                }
                
                // Always reload main timeline
                loadRoomMessages(roomId);
            }
             
             return () => clearTimeout(updateRoomList);
        };
        
        const onTyping = (event: MatrixEvent, room: MatrixRoom) => {
             if (!selectedRoomId || room.roomId !== selectedRoomId) return;
             // FIX: The `getTypingMembers` method does not exist in this SDK version. Use `getMembersWithTyping` instead.
             // FIX: The `getMembersWithTyping` method exists at runtime but is not in the SDK's Room type definition. Cast to `any` to use it.
             setTypingUsers((room as any).getMembersWithTyping().map((m: any) => m.name));
        };
        
        const onReceipt = () => {
             if (!selectedRoomId) return;
             const room = client.getRoom(selectedRoomId);
             if (room) {
                 setMessages(prev => prev.map(m => parseMatrixEvent(room.findEventById(m.id)!)));
             }
        };

        const onUserProfileChange = () => {
            setUserProfileVersion(v => v + 1);
        };

        client.on(ClientEvent.Sync, onSync);
        client.on(RoomEvent.Timeline, onRoomEvent);
        // FIX: The SDK's event emitter typings are incomplete. Use `as any` to listen to the "Room.state" event.
        client.on("Room.state" as any, onRoomStateEvent);
        // FIX: The 'Room.typing' event is not in the SDK's enums; cast to `any` to bypass type checking.
        client.on('Room.typing' as any, onTyping);
        client.on(RoomEvent.Receipt, onReceipt);
        client.on(UserEvent.DisplayName, onUserProfileChange);
        client.on(UserEvent.AvatarUrl, onUserProfileChange);
        client.on(ClientEvent.Room, loadRooms);
        return () => {
            client.removeListener(ClientEvent.Sync, onSync);
            client.removeListener(RoomEvent.Timeline, onRoomEvent);
            // FIX: The SDK's event emitter typings are incomplete. Use `as any` to remove the "Room.state" listener.
            client.removeListener("Room.state" as any, onRoomStateEvent);
            // FIX: The 'Room.typing' event is not in the SDK's enums; cast to `any` to bypass type checking.
            client.removeListener('Room.typing' as any, onTyping);
            client.removeListener(RoomEvent.Receipt, onReceipt);
            client.removeListener(UserEvent.DisplayName, onUserProfileChange);
            client.removeListener(UserEvent.AvatarUrl, onUserProfileChange);
            client.removeListener(ClientEvent.Room, loadRooms);
        };
    }, [client, selectedRoomId, parseMatrixEvent, loadRoomMessages, activeThread, loadPinnedMessage, notificationsEnabled, savedMessagesRoomId]);

    useEffect(() => {
        const onCallIncoming = (call: MatrixCall) => {
            if (activeCall) {
                // FIX: Use string literal for hangup reason as CallErrorCode is not exported.
                // FIX: The `CallErrorCode` type is not exported by the SDK. Cast to `any` to bypass the type check.
                call.hangup('busy' as any, false);
                return;
            }
            console.log("Incoming call:", call);
            setIncomingCall(call);

            if (notificationsEnabled && !document.hasFocus()) {
                const peerMember = (call as any).getPeerMember();
                const peerName = peerMember?.name || 'Unknown User';
                const callType = call.type === 'video' ? 'Video' : 'Voice';
                sendNotification(`Incoming ${callType} Call`, `From: ${peerName}`);
            }
        };

        // FIX: The event for an incoming call on the client is 'Call.incoming', which is not in the SDK's event types. Cast to `any` to bypass the type check.
        client.on('Call.incoming' as any, onCallIncoming);
        return () => {
            // FIX: The event for an incoming call on the client is 'Call.incoming', which is not in the SDK's event types. Cast to `any` to bypass the type check.
            client.removeListener('Call.incoming' as any, onCallIncoming);
        };
    }, [client, activeCall, notificationsEnabled]);

    useEffect(() => {
        if (!activeCall) return;

        const onHangup = () => {
            console.log("Call hung up");
            setActiveCall(null);
        };
        
        activeCall.on(CallEvent.Hangup, onHangup);
        return () => {
            activeCall.removeListener(CallEvent.Hangup, onHangup);
        };
    }, [activeCall]);

    const handleSelectRoom = useCallback(async (roomId: string) => {
        if (selectedRoomId) {
             await sendTypingIndicator(client, selectedRoomId, false);
        }

        setSelectedRoomId(roomId);
        setReplyingTo(null);
        setTypingUsers([]);
        setCanPaginate(true);
        setActiveThread(null); // Close thread view when switching rooms
        setTranslatedMessages({}); // Clear translations when switching rooms
        const room = client.getRoom(roomId);
        if (room) {
            setCanPin(room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, client.getUserId()!));
            loadPinnedMessage(roomId);

            const timeline = room.getLiveTimeline().getEvents();
            const lastEvent = timeline[timeline.length - 1];
            if (lastEvent) {
                await sendReadReceipt(client, roomId, lastEvent.getId()!);
            }

            loadRoomMessages(roomId);
            // FIX: The `getTypingMembers` method does not exist in this SDK version. Use `getMembersWithTyping` instead.
            // FIX: The `getMembersWithTyping` method exists at runtime but is not in the SDK's Room type definition. Cast to `any` to use it.
            setTypingUsers((room as any).getMembersWithTyping().map((m: any) => m.name));
            
            setTimeout(() => scrollToBottom('auto'), 100);
        }
    }, [client, selectedRoomId, scrollToBottom, loadRoomMessages, loadPinnedMessage]);
    
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || isPaginating) return;
        
        const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 1;
        if (isScrolledToBottom) {
             scrollToBottom('auto');
        } else if (oldScrollHeightRef.current > 0) {
            // Restore scroll position after pagination
            container.scrollTop = container.scrollHeight - oldScrollHeightRef.current;
            oldScrollHeightRef.current = 0;
        }
    }, [messages, scrollToBottom, isPaginating]);

    const handleSendMessage = async (content: string, threadRootId?: string) => {
        if (!selectedRoomId || !content.trim()) return;
        setIsSending(true);
        try {
            const room = client.getRoom(selectedRoomId);
            const eventToReplyTo = replyingTo ? room?.findEventById(replyingTo.id) : undefined;
            await sendMessage(client, selectedRoomId, content.trim(), eventToReplyTo, threadRootId, roomMembers);
            setReplyingTo(null);
        } catch (error) {
            console.error('Failed to send message:', error);
        } finally {
            setIsSending(false);
        }
    };
    
    const handleSendFile = async (file: File, threadRootId?: string) => {
        if (!selectedRoomId) return;

        const tempId = `temp-file-${Date.now()}`;
        const isImage = file.type.startsWith('image/');
        const localUrl = isImage ? URL.createObjectURL(file) : undefined;
        const user = client.getUser(client.getUserId()!);

        const tempMessage: Message = {
            id: tempId,
            sender: {
                id: client.getUserId()!,
                name: user?.displayName || 'Me',
                avatarUrl: mxcToHttp(client, user?.avatarUrl),
            },
            content: {
                body: file.name,
                msgtype: isImage ? MsgType.Image : MsgType.File,
                info: {
                    mimetype: file.type,
                    size: file.size,
                }
            },
            timestamp: Date.now(),
            isOwn: true,
            reactions: null, isEdited: false, isRedacted: false, replyTo: null, readBy: {},
            isUploading: true,
            localUrl: localUrl,
            threadReplyCount: 0,
            threadRootId,
        };

        if (threadRootId) {
            setActiveThread(prev => {
                if (!prev || prev.rootMessage.id !== threadRootId) return prev;
                return {
                    ...prev,
                    threadMessages: [...prev.threadMessages, tempMessage],
                };
            });
        } else {
            setMessages(prev => [...prev, tempMessage]);
            scrollToBottom();
        }

        try {
            if (isImage) {
                await sendImageMessage(client, selectedRoomId, file, threadRootId);
            } else {
                await sendFileMessage(client, selectedRoomId, file, threadRootId);
            }
        } catch (error) {
            console.error('Failed to send file:', error);
            if (threadRootId) {
                setActiveThread(prev => {
                    if (!prev || prev.rootMessage.id !== threadRootId) return prev;
                    return {
                        ...prev,
                        threadMessages: prev.threadMessages.filter(m => m.id !== tempId),
                    };
                });
            } else {
                setMessages(prev => prev.filter(m => m.id !== tempId));
            }
        } finally {
            if (localUrl) {
                URL.revokeObjectURL(localUrl);
            }
        }
    };

    const handleSendAudio = async (file: Blob, duration: number, threadRootId?: string) => {
        if (!selectedRoomId) return;

        const tempId = `temp-audio-${Date.now()}`;
        const localUrl = URL.createObjectURL(file);
        const user = client.getUser(client.getUserId()!);

        const tempMessage: Message = {
            id: tempId,
            sender: {
                id: client.getUserId()!,
                name: user?.displayName || 'Me',
                avatarUrl: mxcToHttp(client, user?.avatarUrl),
            },
            content: {
                body: "Voice Message",
                msgtype: MsgType.Audio,
                info: {
                    mimetype: file.type,
                    size: file.size,
                    duration: duration * 1000
                }
            },
            timestamp: Date.now(),
            isOwn: true,
            reactions: null, isEdited: false, isRedacted: false, replyTo: null, readBy: {},
            isUploading: true,
            localUrl: localUrl,
            threadReplyCount: 0,
            threadRootId,
        };

        if (threadRootId) {
            setActiveThread(prev => {
                if (!prev || prev.rootMessage.id !== threadRootId) return prev;
                return {
                    ...prev,
                    threadMessages: [...prev.threadMessages, tempMessage],
                };
            });
        } else {
            setMessages(prev => [...prev, tempMessage]);
            scrollToBottom();
        }

        try {
            await sendAudioMessage(client, selectedRoomId, file, duration, threadRootId);
        } catch (error) {
            console.error('Failed to send audio message:', error);
            if (threadRootId) {
                setActiveThread(prev => {
                    if (!prev || prev.rootMessage.id !== threadRootId) return prev;
                    return {
                        ...prev,
                        threadMessages: prev.threadMessages.filter(m => m.id !== tempId),
                    };
                });
            } else {
                setMessages(prev => prev.filter(m => m.id !== tempId));
            }
        } finally {
            URL.revokeObjectURL(localUrl);
        }
    };

    const handleSendSticker = async (sticker: Sticker, threadRootId?: string) => {
        if (!selectedRoomId) return;
        try {
            await sendStickerMessage(client, selectedRoomId, sticker.url, sticker.body, sticker.info, threadRootId);
        } catch (error) {
            console.error('Failed to send sticker:', error);
        }
    };

    const handleSendGif = async (gif: Gif, threadRootId?: string) => {
        if (!selectedRoomId) return;
        try {
            await sendGifMessage(client, selectedRoomId, gif, threadRootId);
        } catch (error) {
            console.error('Failed to send GIF:', error);
        }
    };

    const handleReaction = async (messageId: string, emoji: string, reaction?: Reaction) => {
        if (!selectedRoomId) return;
        if (reaction?.isOwn && reaction.ownEventId) {
            await client.redactEvent(selectedRoomId, reaction.ownEventId);
        } else {
            await sendReaction(client, selectedRoomId, messageId, emoji);
        }
    };

    const handleEditMessage = async (messageId: string, newContent: string) => {
        if (!selectedRoomId || !newContent.trim()) return;
        await editMessage(client, selectedRoomId, messageId, newContent.trim());
    };
    
    const handleDeleteMessage = async (messageId: string) => {
        if (!selectedRoomId) return;
        await deleteMessage(client, selectedRoomId, messageId);
    };

    const handleOpenForwardModal = (message: Message) => {
        setForwardingMessage(message);
    };

    const handleConfirmForward = async (targetRoomId: string) => {
        if (!forwardingMessage || !selectedRoomId) return;
        const room = client.getRoom(selectedRoomId);
        const originalEvent = room?.findEventById(forwardingMessage.id);

        if (originalEvent) {
            try {
                await forwardMessage(client, targetRoomId, originalEvent);
            } catch (error) {
                console.error("Failed to forward message:", error);
            }
        }
        setForwardingMessage(null);
    };

    const handleScroll = () => {
        const container = scrollContainerRef.current;
        if (container) {
            const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 100;
            setShowScrollToBottom(!isAtBottom);
        }
    };

    const handlePaginate = async () => {
        if (isPaginating || !canPaginate || !selectedRoomId) return;

        setIsPaginating(true);
        const room = client.getRoom(selectedRoomId);
        if (room && scrollContainerRef.current) {
            oldScrollHeightRef.current = scrollContainerRef.current.scrollHeight;
            const hasMore = await paginateRoomHistory(client, room);
            setCanPaginate(hasMore);
            loadRoomMessages(selectedRoomId);
        }
        setIsPaginating(false);
    };
    
    const handleSaveSettings = async (newName: string, newAvatar: File | null) => {
        try {
            const user = client.getUser(client.getUserId()!);
            if (newName.trim() && newName.trim() !== user?.displayName) {
                await setDisplayName(client, newName.trim());
            }
            if (newAvatar) {
                await setAvatar(client, newAvatar);
            }
        } catch(error) {
            console.error("Failed to save settings", error);
        } finally {
            setIsSettingsOpen(false);
        }
    };

    const handleCreateRoom = async (options: { name: string, topic?: string, isPublic: boolean, isEncrypted: boolean }) => {
        try {
            const newRoomId = await createRoom(client, options);
            setIsCreateRoomOpen(false);
            await handleSelectRoom(newRoomId);
        } catch(error) {
            console.error("Failed to create room from component:", error);
        }
    };

    const handleInviteUser = async (userId: string) => {
        if (!selectedRoomId) return;
        await inviteUser(client, selectedRoomId, userId);
        setIsInviteUserOpen(false);
    };

    const handlePinToggle = async (messageId: string) => {
        if (!selectedRoomId || !canPin) return;
        const newPinnedIds = pinnedEventIds.includes(messageId)
            ? pinnedEventIds.filter(id => id !== messageId)
            : [...pinnedEventIds, messageId];
        
        try {
            await setPinnedMessages(client, selectedRoomId, newPinnedIds);
        } catch (error) {
            console.error("Failed to update pinned messages:", error);
        }
    };

    const handleOpenThread = (message: Message) => {
        const room = client.getRoom(selectedRoomId!);
        if (!room) return;
        const thread = room.getThread(message.id);
        const threadMessages = thread?.events.map(parseMatrixEvent) || [];
        setActiveThread({ rootMessage: message, threadMessages });
    };

    const handleCloseThread = () => {
        setActiveThread(null);
    };

    const handleCreatePoll = async (question: string, options: string[], threadRootId?: string) => {
        if (!selectedRoomId || !question.trim() || options.length < 2) return;
        try {
            await sendPollStart(client, selectedRoomId, question, options, threadRootId);
        } catch (error) {
            console.error("Failed to create poll:", error);
        } finally {
            setIsCreatePollOpen(false);
            setPollThreadRootId(undefined);
        }
    };

    const handlePollVote = async (messageId: string, optionId: string) => {
        if (!selectedRoomId) return;
        try {
            await sendPollResponse(client, selectedRoomId, messageId, optionId);
        } catch (error) {
            console.error("Failed to vote in poll:", error);
        }
    };

    const handleOpenCreatePollModal = (threadRootId?: string) => {
        setPollThreadRootId(threadRootId);
        setIsCreatePollOpen(true);
    };

    const handleCloseCreatePollModal = () => {
        setIsCreatePollOpen(false);
        setPollThreadRootId(undefined);
    };

    const handleOpenScheduleModal = (content: string, threadRootId?: string) => {
        setContentToSchedule(content);
        setScheduleThreadRootId(threadRootId);
        setIsScheduleModalOpen(true);
    };

    const handleConfirmSchedule = (sendAt: number, threadRootId?: string) => {
        if (selectedRoomId) {
            addScheduledMessage(selectedRoomId, contentToSchedule, sendAt, threadRootId);
            setAllScheduledMessages(getScheduledMessages());
        }
        setIsScheduleModalOpen(false);
        setContentToSchedule('');
        setScheduleThreadRootId(undefined);
    };
    
    const handleCloseScheduleModal = () => {
        setIsScheduleModalOpen(false);
        setContentToSchedule('');
        setScheduleThreadRootId(undefined);
    };

    const handleDeleteScheduled = (id: string) => {
        deleteScheduledMessage(id);
        setAllScheduledMessages(getScheduledMessages());
    };

    const handleSendScheduledNow = async (id: string) => {
        const msg = allScheduledMessages.find(m => m.id === id);
        if (msg) {
            await sendMessage(client, msg.roomId, msg.content, undefined, msg.threadRootId);
            handleDeleteScheduled(id);
        }
    };

    const handlePlaceCall = (type: 'voice' | 'video') => {
        if (!selectedRoomId || activeCall) return;
        try {
            let call;
            if (type === 'video') {
                // FIX: The 'placeVideoCall' method may not be in the MatrixClient type definition. Cast to 'any' to bypass the check.
                call = (client as any).placeVideoCall(selectedRoomId);
            } else {
                // FIX: The 'placeVoiceCall' method may not be in the MatrixClient type definition. Cast to 'any' to bypass the check.
                call = (client as any).placeVoiceCall(selectedRoomId);
            }
            setActiveCall(call);
        } catch (error) {
            console.error(`Failed to place ${type} call:`, error);
        }
    };

    const handleAnswerCall = () => {
        if (!incomingCall) return;
        incomingCall.answer();
        setActiveCall(incomingCall);
        setIncomingCall(null);
    };

    const handleHangupCall = (isIncoming: boolean) => {
        if (isIncoming && incomingCall) {
            // FIX: Use string literal for hangup reason as CallErrorCode is not exported.
            // FIX: The `CallErrorCode` type is not exported by the SDK. Cast to `any` to bypass the type check.
            incomingCall.hangup('user_hangup' as any, false);
            setIncomingCall(null);
        } else if (!isIncoming && activeCall) {
            // FIX: Use string literal for hangup reason as CallErrorCode is not exported.
            // FIX: The `CallErrorCode` type is not exported by the SDK. Cast to `any` to bypass the type check.
            activeCall.hangup('user_hangup' as any, true);
            setActiveCall(null);
        }
    };

    const handleTranslateMessage = async (messageId: string, text: string) => {
        // If translation is already shown, hide it (toggle)
        if (translatedMessages[messageId] && !translatedMessages[messageId].isLoading) {
            setTranslatedMessages(prev => {
                const newTranslations = { ...prev };
                delete newTranslations[messageId];
                return newTranslations;
            });
            return;
        }

        setTranslatedMessages(prev => ({ ...prev, [messageId]: { text: '', isLoading: true } }));
        try {
            const translatedText = await translateText(text);
            setTranslatedMessages(prev => ({ ...prev, [messageId]: { text: translatedText, isLoading: false } }));
        } catch (error) {
            console.error("Translation failed in component:", error);
            setTranslatedMessages(prev => {
                const newTranslations = { ...prev };
                delete newTranslations[messageId];
                return newTranslations;
            });
        }
    };


    const selectedRoom = rooms.find(r => r.roomId === selectedRoomId);
    const savedMessagesRoom = rooms.find(r => r.roomId === savedMessagesRoomId);
    const matrixRoom = selectedRoomId ? client.getRoom(selectedRoomId) : null;
    const canInvite = matrixRoom?.canInvite(client.getUserId()!) || false;
    const scheduledForThisRoom = allScheduledMessages.filter(m => m.roomId === selectedRoomId);
    const scheduledForMainTimeline = scheduledForThisRoom.filter(m => !m.threadRootId);

    return (
        <div className="flex h-screen">
            <RoomList
                key={userProfileVersion}
                rooms={rooms}
                selectedRoomId={selectedRoomId}
                onSelectRoom={handleSelectRoom}
                isLoading={isLoading}
                onLogout={onLogout}
                client={client}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenCreateRoom={() => setIsCreateRoomOpen(true)}
                folders={folders}
                activeFolderId={activeFolderId}
                onSelectFolder={setActiveFolderId}
                onManageFolders={() => setIsManageFoldersOpen(true)}
            />
            <main
                style={{ backgroundImage: chatBackground ? `url(${chatBackground})` : 'none' }}
                className={`flex-1 flex flex-col bg-bg-tertiary relative transition-all duration-300 bg-cover bg-center ${activeThread ? 'w-1/2' : 'w-full'}`}>
                {selectedRoom ? (
                    <>
                        <ChatHeader 
                            room={selectedRoom} 
                            typingUsers={typingUsers}
                            canInvite={canInvite}
                            onOpenInvite={() => setIsInviteUserOpen(true)}
                            pinnedMessage={pinnedMessage}
                            onPinToggle={handlePinToggle}
                            scheduledMessageCount={scheduledForMainTimeline.length}
                            onOpenViewScheduled={() => setIsViewScheduledModalOpen(true)}
                            isDirectMessageRoom={selectedRoom.isDirectMessageRoom}
                            onPlaceCall={handlePlaceCall}
                        />
                        <MessageView 
                            messages={messages} 
                            client={client}
                            onReaction={handleReaction} 
                            onEditMessage={handleEditMessage}
                            onDeleteMessage={handleDeleteMessage}
                            onSetReplyTo={setReplyingTo}
                            onForwardMessage={handleOpenForwardModal}
                            onImageClick={setViewingImageUrl}
                            onOpenThread={handleOpenThread}
                            onPollVote={handlePollVote}
                            onTranslateMessage={handleTranslateMessage}
                            translatedMessages={translatedMessages}
                            scrollContainerRef={scrollContainerRef}
                            onScroll={handleScroll}
                            onPaginate={handlePaginate}
                            isPaginating={isPaginating}
                            canPaginate={canPaginate}
                            pinnedEventIds={pinnedEventIds}
                            canPin={canPin}
                            onPinToggle={handlePinToggle}
                        />
                         {showScrollToBottom && (
                            <button
                                onClick={() => scrollToBottom()}
                                className="absolute bottom-24 right-8 bg-accent text-text-inverted rounded-full h-12 w-12 flex items-center justify-center shadow-lg hover:bg-accent-hover transition"
                                aria-label="Scroll to bottom"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                </svg>
                            </button>
                        )}
                        <MessageInput 
                            onSendMessage={handleSendMessage} 
                            onSendFile={handleSendFile}
                            onSendAudio={handleSendAudio}
                            onSendSticker={handleSendSticker}
                            onSendGif={handleSendGif}
                            onOpenCreatePoll={() => handleOpenCreatePollModal()}
                            onSchedule={handleOpenScheduleModal}
                            isSending={isSending}
                            client={client}
                            roomId={selectedRoomId}
                            replyingTo={replyingTo}
                            onCancelReply={() => setReplyingTo(null)}
                            roomMembers={roomMembers}
                        />
                    </>
                ) : <WelcomeView client={client} />}
            </main>
            
            {activeThread && selectedRoomId && (
                <ThreadView
                    room={client.getRoom(selectedRoomId)!}
                    activeThread={activeThread}
                    onClose={handleCloseThread}
                    client={client}
                    onSendMessage={handleSendMessage}
                    onImageClick={setViewingImageUrl}
                    onSendFile={(file, threadRootId) => handleSendFile(file, threadRootId)}
                    onSendAudio={(file, duration, threadRootId) => handleSendAudio(file, duration, threadRootId)}
                    onSendSticker={(sticker, threadRootId) => handleSendSticker(sticker, threadRootId)}
                    onSendGif={(gif, threadRootId) => handleSendGif(gif, threadRootId)}
                    onOpenCreatePoll={(threadRootId) => handleOpenCreatePollModal(threadRootId)}
                    onSchedule={(content, threadRootId) => handleOpenScheduleModal(content, threadRootId)}
                />
            )}

            {isSettingsOpen && (
                <SettingsModal
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                    onSave={handleSaveSettings}
                    client={client}
                    notificationsEnabled={notificationsEnabled}
                    onSetNotificationsEnabled={setNotificationsEnabled}
                    chatBackground={chatBackground}
                    onSetChatBackground={handleSetChatBackground}
                    onResetChatBackground={handleResetChatBackground}
                />
            )}

            {isCreateRoomOpen && (
                <CreateRoomModal
                    isOpen={isCreateRoomOpen}
                    onClose={() => setIsCreateRoomOpen(false)}
                    onCreate={handleCreateRoom}
                />
            )}
             {isCreatePollOpen && (
                <CreatePollModal
                    isOpen={isCreatePollOpen}
                    onClose={handleCloseCreatePollModal}
                    onCreate={handleCreatePoll}
                    threadRootId={pollThreadRootId}
                />
            )}
            
            {isManageFoldersOpen && (
                <ManageFoldersModal
                    isOpen={isManageFoldersOpen}
                    onClose={() => setIsManageFoldersOpen(false)}
                    onSave={handleSaveFolders}
                    initialFolders={folders}
                    allRooms={rooms}
                />
            )}
            
             {isScheduleModalOpen && (
                <ScheduleMessageModal
                    isOpen={isScheduleModalOpen}
                    onClose={handleCloseScheduleModal}
                    onConfirm={handleConfirmSchedule}
                    messageContent={contentToSchedule}
                    threadRootId={scheduleThreadRootId}
                />
            )}
            
            {isViewScheduledModalOpen && (
                <ViewScheduledMessagesModal
                    isOpen={isViewScheduledModalOpen}
                    onClose={() => setIsViewScheduledModalOpen(false)}
                    messages={scheduledForThisRoom}
                    onDelete={handleDeleteScheduled}
                    onSendNow={handleSendScheduledNow}
                />
            )}

            {isInviteUserOpen && selectedRoom && (
                <InviteUserModal
                    isOpen={isInviteUserOpen}
                    onClose={() => setIsInviteUserOpen(false)}
                    onInvite={handleInviteUser}
                    roomName={selectedRoom.name}
                />
            )}

            {forwardingMessage && (
                 <ForwardMessageModal
                    isOpen={!!forwardingMessage}
                    onClose={() => setForwardingMessage(null)}
                    onForward={handleConfirmForward}
                    rooms={rooms.filter(r => r.roomId !== selectedRoomId && r.roomId !== savedMessagesRoomId)}
                    message={forwardingMessage}
                    client={client}
                    savedMessagesRoom={savedMessagesRoom || null}
                />
            )}
             {viewingImageUrl && (
                <ImageViewerModal 
                    imageUrl={viewingImageUrl} 
                    onClose={() => setViewingImageUrl(null)} 
                />
            )}
            {activeCall && <CallView call={activeCall} onHangup={() => handleHangupCall(false)} client={client} />}
            {incomingCall && <IncomingCallModal call={incomingCall} onAccept={handleAnswerCall} onDecline={() => handleHangupCall(true)} client={client} />}
        </div>
    );
};

export default ChatPage;
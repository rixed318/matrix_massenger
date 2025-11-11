import React, { useState, useEffect, useCallback, useRef, useMemo, useReducer } from 'react';
// FIX: Import MatrixRoom to correctly type room objects from the SDK.
import { Room as UIRoom, Message, MatrixEvent, Reaction, ReplyInfo, MatrixClient, MatrixRoom, ActiveThread, MatrixUser, Poll, PollResult, Folder, ScheduledMessage, ScheduledMessageScheduleUpdate, ScheduledMessageUpdatePayload, MatrixCall, LinkPreviewData, Sticker, Gif, RoomNotificationMode, Story } from '@matrix-messenger/core';
import RoomList from './RoomList';
import MessageView from './MessageView';
import ChatHeader from './ChatHeader';
import MessageInput from './MessageInput';
import { mxcToHttp, sendReaction, sendTypingIndicator, editMessage, sendMessage, deleteMessage, sendImageMessage, sendReadReceipt, sendFileMessage, setDisplayName, setAvatar, createRoom, inviteUser, forwardMessage, paginateRoomHistory, sendAudioMessage, sendVideoMessage, setPinnedMessages, sendPollStart, sendPollResponse, translateText, sendStickerMessage, sendGifMessage, sendLocationMessage, getSecureCloudProfileForClient, getRoomNotificationMode, setRoomNotificationMode as updateRoomPushRule, RoomCreationOptions, getRoomTTL, setRoomTTL, isRoomHidden, setRoomHidden } from '@matrix-messenger/core';
import { startGroupCall, joinGroupCall, getDisplayMedia, enumerateDevices } from '@matrix-messenger/core';
import {
    getScheduledMessages,
    addScheduledMessage,
    deleteScheduledMessage,
    updateScheduledMessage,
    bulkUpdateScheduledMessages,
    markScheduledMessageSent,
    recordScheduledMessageError,
    applyScheduledMessagesEvent,
    SCHEDULED_MESSAGES_EVENT_TYPE,
} from '@matrix-messenger/core';
import { checkPermission, sendNotification, setupNotificationListeners, subscribeToWebPush, isWebPushSupported, registerMatrixWebPush, setRoomNotificationPreference, setRoomNotificationPreferences } from '@matrix-messenger/core';
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
import SearchModal from './SearchModal';
import PluginCatalogModal from './PluginCatalogModal';
import PluginSurfaceHost from './PluginSurfaceHost';
import { SearchResultItem } from '@matrix-messenger/core';
import type { DraftContent, SendKeyBehavior, DraftAttachment, DraftAttachmentKind, VideoMessageMetadata, LocationContentPayload } from '../types';
import SharedMediaPanel from './SharedMediaPanel';
import type { RoomMediaSummary, SharedMediaCategory, RoomMediaItem } from '@matrix-messenger/core';
// FIX: The `matrix-js-sdk` exports event names as enums. Import them to use with the event emitter.
// FIX: Import event enums to use with the event emitter instead of string literals, which are not assignable.
// FIX: `CallErrorCode` is not an exported member of `matrix-js-sdk`. It has been removed.
import { NotificationCountType, EventType, MsgType, ClientEvent, RoomEvent, UserEvent, RelationType, CallEvent } from 'matrix-js-sdk';
import { startSecureCloudSession, acknowledgeSuspiciousEvents, normaliseSecureCloudProfile } from '../services/secureCloudService';
import type {
    SuspiciousEventNotice,
    SecureCloudSession,
    SecureCloudProfile,
    SecureCloudDetectorState,
    SecureCloudDetectorStatus,
    SecureCloudDetectorConfig,
} from '../services/secureCloudService';
import {
    setSecureCloudProfileForClient,
    onOutboxEvent,
    getOutboxPending,
    cancelOutboxItem,
    retryOutboxItem,
    OutboxPayload,
    OutboxProgressState,
    startGroupCall,
    createGroupCallCoordinator,
    leaveGroupCallCoordinator,
    GroupCallParticipant,
    buildCallSessionSnapshot,
    CallSessionState,
    handoverCallToCurrentDevice,
    resolveAccountKeyFromClient,
    getCallSessionForAccount,
    setCallSessionForClient,
    updateLocalCallDeviceState,
} from '../services/matrixService';
import GroupCallCoordinator from '../services/webrtc/groupCallCoordinator';
import { GROUP_CALL_STATE_EVENT_TYPE, GroupCallStageState } from '../services/webrtc/groupCallConstants';
import type { CallLayout } from './CallView';
import { useAccountStore } from '../services/accountManager';
import { getAppLockSnapshot, unlockWithPin, unlockWithBiometric, isSessionUnlocked, ensureAppLockConsistency } from '../services/appLockService';
import { presenceReducer, PresenceEventContent } from '../state/presenceReducer';
import { useStoryStore, markActiveStoryAsRead, toggleActiveStoryReaction } from '../state/storyStore';
import {
    describePresence,
    canSharePresenceInRoom,
    buildRestrictedPresenceSummary,
    buildHiddenPresenceSummary,
    formatMatrixIdForDisplay,
    type PresenceSummary,
} from '../utils/presence';
import {
    isAnimatedReactionsEnabled,
    setAnimatedReactionsEnabled as persistAnimatedReactionsEnabled,
    onAnimatedReactionsPreferenceChange,
} from '../services/animatedReactions';
import {
    useDigestStore,
    setActiveDigestAccount,
    hydrateDigestsForAccount,
    updateDigestUnreadCounts,
    generateRoomDigest,
    DEFAULT_DIGEST_ACCOUNT_KEY,
} from '../services/digestService';

interface ChatPageProps {
    client?: MatrixClient;
    onLogout?: () => void;
    savedMessagesRoomId?: string;
}

const DRAFT_STORAGE_KEY = 'matrix-message-drafts';
const DRAFT_ACCOUNT_DATA_EVENT = 'econix.message_drafts';

type PendingQueueSummary = OutboxPayload & { attempts: number; error?: string; progress?: OutboxProgressState };

interface ChatTimelineSectionProps {
    secureCloud: {
        isActive: boolean;
        error: string | null;
        detectors: SecureCloudDetectorState[];
        formatStatus: (state: SecureCloudDetectorState) => string;
        onClearError: () => void;
        onToggleDetector: (detectorId: string, enabled: boolean) => void;
        onUpdateDetectorConfig: (detectorId: string, patch: SecureCloudDetectorConfig) => void;
        alerts: SuspiciousEventNotice[];
        roomId: string | null;
        onDismissAlert: (roomId: string, eventId?: string) => void;
    };
    verification: {
        requests: unknown[];
        onAccept: (request: unknown) => void;
        onDecline: (request: unknown) => void;
    };
    messageView: {
        messages: Message[];
        client: MatrixClient;
        onReaction: (messageId: string, emoji: string, reaction?: Reaction) => void;
        onEditMessage: (messageId: string, newContent: string) => void;
        onDeleteMessage: (messageId: string) => void;
        onSetReplyTo: (message: Message) => void;
        onForwardMessage: (message: Message) => void;
        onImageClick: (url: string) => void;
        onOpenThread: (message: Message) => void;
        onPollVote: (messageId: string, optionId: string) => void;
        onTranslateMessage: (messageId: string, text: string) => void;
        translatedMessages: Record<string, { text: string; isLoading: boolean }>;
        scrollContainerRef: React.RefObject<HTMLDivElement>;
        onScroll: () => void;
        onPaginate: () => void;
        isPaginating: boolean;
        canPaginate: boolean;
        pinnedEventIds: string[];
        canPin: boolean;
        onPinToggle: (messageId: string) => void;
        highlightedMessageId: string | null;
        pendingMessages: Message[];
        pendingQueue: PendingQueueSummary[];
        onRetryPending: (id: string) => void;
        onCancelPending: (id: string) => void;
    };
    showScrollToBottom: boolean;
    onScrollToBottom: () => void;
}

interface ChatComposerSectionProps {
    composer: {
        onSendMessage: (content: { body: string; formattedBody?: string }, threadRootId?: string) => Promise<void> | void;
        onSendFile: (file: File) => Promise<void> | void;
        onSendAudio: (file: Blob, duration: number) => Promise<void> | void;
        onSendVideo: (file: Blob, metadata: VideoMessageMetadata) => Promise<void> | void;
        onSendSticker: (sticker: Sticker) => Promise<void> | void;
        onSendGif: (gif: Gif) => Promise<void> | void;
        onSendLocation: (payload: LocationContentPayload) => Promise<void> | void;
        onOpenCreatePoll: () => void;
        onSchedule: (content: DraftContent) => void;
        isSending: boolean;
        client: MatrixClient;
        roomId: string | null;
        replyingTo: Message | null;
        onCancelReply: () => void;
        roomMembers: MatrixUser[];
        draftContent: DraftContent | null;
        onDraftChange: (content: DraftContent) => void;
        isOffline: boolean;
        sendKeyBehavior: SendKeyBehavior;
        pendingQueue: PendingQueueSummary[];
        onRetryPending: (id: string) => void;
        onCancelPending: (id: string) => void;
    };
}

interface ChatSidePanelsProps {
    thread: {
        activeThread: ActiveThread | null;
        selectedRoomId: string | null;
        onCloseThread: () => void;
        client: MatrixClient;
        onSendMessage: (content: { body: string; formattedBody?: string }, threadRootId?: string) => Promise<void> | void;
        onImageClick: (url: string) => void;
        sendKeyBehavior: SendKeyBehavior;
    };
    settings: {
        isOpen: boolean;
        onClose: () => void;
        onSave: (newName: string, newAvatar: File | null) => void;
        client: MatrixClient;
        notificationsEnabled: boolean;
        onSetNotificationsEnabled: (enabled: boolean) => void;
        chatBackground: string;
        onSetChatBackground: (url: string) => void;
        onResetChatBackground: () => void;
        sendKeyBehavior: SendKeyBehavior;
        onSetSendKeyBehavior: (behavior: SendKeyBehavior) => void;
        isPresenceHidden: boolean;
        onSetPresenceHidden: (hidden: boolean) => void;
        presenceRestricted: boolean;
        animatedReactionsEnabled: boolean;
        onSetAnimatedReactionsEnabled: (enabled: boolean) => void;
    };
    createRoom: {
        isOpen: boolean;
        onClose: () => void;
        onCreate: (options: RoomCreationOptions) => Promise<string> | string | void;
    };
    createPoll: {
        isOpen: boolean;
        onClose: () => void;
        onCreate: (question: string, options: string[]) => Promise<void> | void;
    };
    manageFolders: {
        isOpen: boolean;
        onClose: () => void;
        onSave: (folders: Folder[]) => void;
        initialFolders: Folder[];
        rooms: UIRoom[];
    };
    schedule: {
        isOpen: boolean;
        onClose: () => void;
        onConfirm: (selection: { sendAtUtc: number; timezoneOffset: number; timezoneId: string; localTimestamp: number }) => Promise<void> | void;
        content: DraftContent | null;
    };
    scheduledList: {
        isOpen: boolean;
        onClose: () => void;
        messages: ScheduledMessage[];
        onDelete: (id: string) => Promise<void> | void;
        onSendNow: (id: string) => Promise<void> | void;
        onUpdate: (id: string, update: ScheduledMessageUpdatePayload) => Promise<void>;
        onBulkReschedule: (ids: string[], schedule: ScheduledMessageScheduleUpdate) => Promise<void>;
        onBulkSend: (ids: string[]) => Promise<void>;
    };
    hiddenRooms: {
        isPromptOpen: boolean;
        pinInput: string;
        onPinInputChange: (value: string) => void;
        pinError: string | null;
        onCancel: () => void;
        onUnlockBiometric?: () => void;
        onUnlockPin: () => void;
        appLockEnabled: boolean;
        biometricEnabled: boolean;
    };
    invite: {
        isOpen: boolean;
        onClose: () => void;
        onInvite: (userId: string) => Promise<void> | void;
        roomName?: string;
    };
    forwarding: {
        message: Message | null;
        onClose: () => void;
        onForward: (roomId: string) => Promise<void> | void;
        rooms: UIRoom[];
        client: MatrixClient;
        savedMessagesRoom: UIRoom | null | undefined;
        currentRoomId: string | null;
    };
    mediaViewer: {
        imageUrl: string | null;
        onClose: () => void;
    };
    search: {
        isOpen: boolean;
        onClose: () => void;
        client: MatrixClient;
        rooms: UIRoom[];
        onSelectResult: (result: SearchResultItem) => void;
    };
    plugins: {
        isOpen: boolean;
        onClose: () => void;
    };
    sharedMedia: {
        isOpen: boolean;
        onClose: () => void;
        data: RoomMediaSummary | null;
        isLoading: boolean;
        isPaginating: boolean;
        onLoadMore?: () => void;
        currentUserId?: string;
    };
    groupCall: {
        activeGroupCall: {
            roomId: string;
            sessionId: string;
            url: string;
            layout: CallLayout;
            isScreensharing: boolean;
            isMuted: boolean;
            isVideoMuted: boolean;
            coWatchActive: boolean;
        } | null;
        participantViews: GroupCallParticipant[];
        showParticipantsPanel: boolean;
        onToggleParticipantsPanel: () => void;
        onLayoutChange: (layout: CallLayout) => void;
        onToggleScreenshare: () => void;
        onToggleMute: () => void;
        onToggleVideo: () => void;
        onToggleCoWatch: () => void;
        onMuteParticipant: (userId: string) => void;
        onVideoParticipantToggle: (userId: string) => void;
        onRemoveParticipant: (userId: string) => void;
        onPromotePresenter: (userId: string) => void;
        onSpotlightParticipant: (userId: string | null) => void;
        localUserId?: string;
        canModerateParticipants: boolean;
        client: MatrixClient;
        onHangup: () => void;
    };
    calls: {
        activeCall: MatrixCall | null;
        incomingCall: MatrixCall | null;
        onHangup: (isIncoming: boolean) => void;
        onAccept: () => void;
        onDecline: () => void;
        client: MatrixClient;
        callSession?: CallSessionState | null;
        onHandover?: () => void;
        localDeviceId?: string | null;
    };
    groupCallPermission: {
        error: string | null;
        onDismiss: () => void;
    };
}

const ChatTimelineSection: React.FC<ChatTimelineSectionProps> = ({ secureCloud, verification, messageView, showScrollToBottom, onScrollToBottom }) => {
    const {
        messages,
        client,
        onReaction,
        onEditMessage,
        onDeleteMessage,
        onSetReplyTo,
        onForwardMessage,
        onImageClick,
        onOpenThread,
        onPollVote,
        onTranslateMessage,
        translatedMessages,
        scrollContainerRef,
        onScroll,
        onPaginate,
        isPaginating,
        canPaginate,
        pinnedEventIds,
        canPin,
        onPinToggle,
        highlightedMessageId,
        pendingMessages,
        pendingQueue,
        onRetryPending,
        onCancelPending,
    } = messageView;

    return (
        <>
            {secureCloud.isActive && (
                <div className="px-4 pt-3 space-y-3">
                    {secureCloud.error && (
                        <div className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-600 flex items-start justify-between gap-4">
                            <span>Secure Cloud: {secureCloud.error}</span>
                            <button
                                type="button"
                                onClick={secureCloud.onClearError}
                                className="text-xs font-semibold uppercase tracking-wide text-red-600/80 hover:text-red-600"
                            >
                                Скрыть
                            </button>
                        </div>
                    )}
                    {secureCloud.detectors.length > 0 && (
                        <div className="rounded-md border border-neutral-500/40 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-100 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-sm">Детекторы Secure Cloud</span>
                            </div>
                            <ul className="space-y-2">
                                {secureCloud.detectors.map(state => {
                                    const mergedConfig: SecureCloudDetectorConfig = {
                                        ...(state.detector.defaultConfig ?? {}),
                                        ...(state.config ?? {}),
                                    };
                                    const derivedThreshold = typeof mergedConfig.threshold === 'number'
                                        ? mergedConfig.threshold
                                        : typeof state.detector.defaultConfig?.threshold === 'number'
                                            ? state.detector.defaultConfig.threshold
                                            : 0.6;
                                    const thresholdValue = Number.isFinite(derivedThreshold)
                                        ? Math.min(0.95, Math.max(0.2, derivedThreshold))
                                        : 0.6;
                                    const languageValue = typeof mergedConfig.language === 'string'
                                        ? mergedConfig.language
                                        : 'auto';
                                    const configDisabled = !state.enabled && !state.detector.required;
                                    const showThresholdControl = state.detector.defaultConfig?.threshold !== undefined
                                        || typeof state.config?.threshold === 'number';
                                    const showLanguageControl = state.detector.defaultConfig?.language !== undefined
                                        || typeof state.config?.language === 'string';

                                    return (
                                        <li key={state.detector.id} className="flex flex-col gap-2">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-sm text-neutral-100">{state.detector.displayName}</span>
                                                        {state.detector.required && (
                                                            <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">обязательный</span>
                                                        )}
                                                    </div>
                                                    {state.detector.description && (
                                                        <p className="text-[11px] text-neutral-400 mt-0.5">{state.detector.description}</p>
                                                    )}
                                                    <p className="text-[10px] text-neutral-500 mt-1">{secureCloud.formatStatus(state)}</p>
                                                </div>
                                                <label className="flex items-center gap-2 text-[11px] text-neutral-300">
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-neutral-500 bg-transparent text-emerald-500 focus:ring-emerald-500"
                                                        checked={state.detector.required || state.enabled}
                                                        onChange={(event) => secureCloud.onToggleDetector(state.detector.id, event.target.checked)}
                                                        disabled={state.detector.required}
                                                    />
                                                    <span className="select-none">{state.detector.required ? 'Всегда' : state.enabled ? 'Вкл.' : 'Выкл.'}</span>
                                                </label>
                                            </div>
                                            {(showThresholdControl || showLanguageControl) && (
                                                <div className="pl-1 space-y-2">
                                                    {showThresholdControl && (
                                                        <div>
                                                            <div className="flex items-center justify-between text-[11px] text-neutral-400">
                                                                <span>Порог срабатывания</span>
                                                                <span>{Math.round(thresholdValue * 100)}%</span>
                                                            </div>
                                                            <input
                                                                type="range"
                                                                min="0.2"
                                                                max="0.95"
                                                                step="0.01"
                                                                value={thresholdValue}
                                                                onChange={(event) => {
                                                                    const value = Number(event.target.value);
                                                                    if (!Number.isNaN(value)) {
                                                                        secureCloud.onUpdateDetectorConfig(state.detector.id, { threshold: value });
                                                                    }
                                                                }}
                                                                disabled={configDisabled}
                                                                className="w-full mt-1 accent-emerald-500"
                                                            />
                                                        </div>
                                                    )}
                                                    {showLanguageControl && (
                                                        <div>
                                                            <label className="block text-[11px] text-neutral-400 mb-1">Язык модели</label>
                                                            <select
                                                                value={languageValue}
                                                                onChange={(event) => secureCloud.onUpdateDetectorConfig(state.detector.id, { language: event.target.value })}
                                                                disabled={configDisabled}
                                                                className="w-full rounded border border-neutral-600 bg-neutral-900/80 px-2 py-1 text-[11px] text-neutral-200 focus:border-emerald-500 focus:outline-none"
                                                            >
                                                                <option value="auto">Авто</option>
                                                                <option value="ru">Русский</option>
                                                                <option value="en">English</option>
                                                            </select>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                    {secureCloud.alerts.length > 0 ? (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 space-y-2">
                            <div className="flex items-center justify-between gap-4">
                                <span className="font-semibold">Secure Cloud обнаружил подозрительную активность</span>
                                <button
                                    type="button"
                                    onClick={() => secureCloud.roomId && secureCloud.onDismissAlert(secureCloud.roomId)}
                                    className="text-xs uppercase tracking-wide text-amber-700/80 hover:text-amber-700"
                                    disabled={!secureCloud.roomId}
                                >
                                    Очистить всё
                                </button>
                            </div>
                            <ul className="space-y-2 max-h-40 overflow-auto pr-1">
                                {secureCloud.alerts.map(alert => (
                                    <li key={alert.eventId} className="flex items-start justify-between gap-3 text-xs text-amber-700/90">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium truncate">{alert.sender}</span>
                                                <span className="text-[10px] uppercase tracking-wide">Риск {Math.round(alert.riskScore * 100)}%</span>
                                            </div>
                                            <p className="mt-1 break-words text-text-primary/90">{alert.summary || 'Без текста'}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => secureCloud.onDismissAlert(alert.roomId, alert.eventId)}
                                            className="text-[10px] uppercase tracking-wide text-amber-700/70 hover:text-amber-700"
                                        >
                                            Скрыть
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                </div>
            )}

            {verification.requests.length > 0 && (
                <div className="px-4 pt-3">
                    <div className="rounded-md border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 space-y-2">
                        <div className="font-semibold">Запросы подтверждения устройств</div>
                        <ul className="space-y-2">
                            {verification.requests.map((req, idx) => (
                                <li key={idx} className="flex items-center justify-between gap-4">
                                    <span className="truncate">{String((req as any)?.sender?.userId || (req as any)?.getInitiator?.()?.userId || 'неизвестный пользователь')}</span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => verification.onAccept(req)}
                                            className="px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-800 text-xs"
                                        >
                                            Начать проверку
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => verification.onDecline(req)}
                                            className="px-2 py-1 rounded-md border border-neutral-400/60 text-neutral-700 text-xs"
                                        >
                                            Отклонить
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            <MessageView
                messages={messages}
                client={client}
                onReaction={onReaction}
                onEditMessage={onEditMessage}
                onDeleteMessage={onDeleteMessage}
                onSetReplyTo={onSetReplyTo}
                onForwardMessage={onForwardMessage}
                onImageClick={onImageClick}
                onOpenThread={onOpenThread}
                onPollVote={onPollVote}
                onTranslateMessage={onTranslateMessage}
                translatedMessages={translatedMessages}
                scrollContainerRef={scrollContainerRef}
                onScroll={onScroll}
                onPaginate={onPaginate}
                isPaginating={isPaginating}
                canPaginate={canPaginate}
                pinnedEventIds={pinnedEventIds}
                canPin={canPin}
                onPinToggle={onPinToggle}
                highlightedMessageId={highlightedMessageId}
                pendingMessages={pendingMessages}
                pendingQueue={pendingQueue}
                onRetryPending={onRetryPending}
                onCancelPending={onCancelPending}
            />

            {showScrollToBottom && (
                <button
                    onClick={onScrollToBottom}
                    className="absolute bottom-24 right-8 bg-accent text-text-inverted rounded-full h-12 w-12 flex items-center justify-center shadow-lg hover:bg-accent-hover transition"
                    aria-label="Scroll to bottom"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                </button>
            )}
        </>
    );
};

const ChatComposerSection: React.FC<ChatComposerSectionProps> = ({ composer }) => {
    const {
        onSendMessage,
        onSendFile,
        onSendAudio,
        onSendVideo,
        onSendSticker,
        onSendGif,
        onSendLocation,
        onOpenCreatePoll,
        onSchedule,
        isSending,
        client,
        roomId,
        replyingTo,
        onCancelReply,
        roomMembers,
        draftContent,
        onDraftChange,
        isOffline,
        sendKeyBehavior,
        pendingQueue,
        onRetryPending,
        onCancelPending,
    } = composer;

    return (
        <MessageComposer
            onSendMessage={onSendMessage}
            onSendFile={onSendFile}
            onSendAudio={onSendAudio}
            onSendVideo={onSendVideo}
            onSendSticker={onSendSticker}
            onSendGif={onSendGif}
            onSendLocation={onSendLocation}
            onOpenCreatePoll={onOpenCreatePoll}
            onSchedule={onSchedule}
            isSending={isSending}
            client={client}
            roomId={roomId}
            replyingTo={replyingTo}
            onCancelReply={onCancelReply}
            roomMembers={roomMembers}
            draftContent={draftContent}
            onDraftChange={onDraftChange}
            isOffline={isOffline}
            sendKeyBehavior={sendKeyBehavior}
            pendingQueue={pendingQueue}
            onRetryPending={onRetryPending}
            onCancelPending={onCancelPending}
        />
    );
};

const ChatSidePanels: React.FC<ChatSidePanelsProps> = ({
    thread,
    settings,
    createRoom,
    createPoll,
    manageFolders,
    schedule,
    scheduledList,
    hiddenRooms,
    invite,
    forwarding,
    mediaViewer,
    search,
    plugins,
    sharedMedia,
    groupCall,
    calls,
    groupCallPermission,
}) => {
    return (
        <>
            {thread.activeThread && thread.selectedRoomId && (
                <ThreadView
                    room={thread.client.getRoom(thread.selectedRoomId)!}
                    activeThread={thread.activeThread}
                    onClose={thread.onCloseThread}
                    client={thread.client}
                    onSendMessage={thread.onSendMessage}
                    onImageClick={thread.onImageClick}
                    sendKeyBehavior={thread.sendKeyBehavior}
                />
            )}

            {settings.isOpen && (
                <SettingsModal
                    isOpen={settings.isOpen}
                    onClose={settings.onClose}
                    onSave={settings.onSave}
                    client={settings.client}
                    notificationsEnabled={settings.notificationsEnabled}
                    onSetNotificationsEnabled={settings.onSetNotificationsEnabled}
                    chatBackground={settings.chatBackground}
                    onSetChatBackground={settings.onSetChatBackground}
                    onResetChatBackground={settings.onResetChatBackground}
                    sendKeyBehavior={settings.sendKeyBehavior}
                    onSetSendKeyBehavior={settings.onSetSendKeyBehavior}
                    isPresenceHidden={settings.isPresenceHidden}
                    onSetPresenceHidden={settings.onSetPresenceHidden}
                    presenceRestricted={settings.presenceRestricted}
                    animatedReactionsEnabled={settings.animatedReactionsEnabled}
                    onSetAnimatedReactionsEnabled={settings.onSetAnimatedReactionsEnabled}
                />
            )}

            {createRoom.isOpen && (
                <CreateRoomModal
                    isOpen={createRoom.isOpen}
                    onClose={createRoom.onClose}
                    onCreate={createRoom.onCreate}
                />
            )}

            {createPoll.isOpen && (
                <CreatePollModal
                    isOpen={createPoll.isOpen}
                    onClose={createPoll.onClose}
                    onCreate={createPoll.onCreate}
                />
            )}

            {manageFolders.isOpen && (
                <ManageFoldersModal
                    isOpen={manageFolders.isOpen}
                    onClose={manageFolders.onClose}
                    onSave={manageFolders.onSave}
                    initialFolders={manageFolders.initialFolders}
                    allRooms={manageFolders.rooms}
                />
            )}

            {schedule.isOpen && (
                <ScheduleMessageModal
                    isOpen={schedule.isOpen}
                    onClose={schedule.onClose}
                    onConfirm={schedule.onConfirm}
                    messageContent={schedule.content}
                />
            )}

            {scheduledList.isOpen && (
                <ViewScheduledMessagesModal
                    isOpen={scheduledList.isOpen}
                    onClose={scheduledList.onClose}
                    messages={scheduledList.messages}
                    onDelete={scheduledList.onDelete}
                    onSendNow={scheduledList.onSendNow}
                    onUpdate={scheduledList.onUpdate}
                    onBulkReschedule={scheduledList.onBulkReschedule}
                    onBulkSend={scheduledList.onBulkSend}
                />
            )}

            {hiddenRooms.isPromptOpen && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-sm p-6 space-y-4">
                        <h3 className="text-lg font-semibold text-text-primary">Введите PIN для скрытых комнат</h3>
                        {hiddenRooms.pinError && (
                            <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/40 rounded-md px-3 py-2">
                                {hiddenRooms.pinError}
                            </div>
                        )}
                        <input
                            type="password"
                            value={hiddenRooms.pinInput}
                            onChange={(event) => hiddenRooms.onPinInputChange(event.target.value)}
                            className="w-full rounded-md border border-border-secondary bg-bg-secondary px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
                            placeholder="Введите PIN"
                        />
                        <div className="flex items-center justify-between">
                            <button
                                type="button"
                                onClick={hiddenRooms.onCancel}
                                className="px-3 py-2 text-sm text-text-secondary hover:text-text-primary"
                            >
                                Отмена
                            </button>
                            {hiddenRooms.appLockEnabled && hiddenRooms.biometricEnabled && hiddenRooms.onUnlockBiometric && (
                                <button
                                    type="button"
                                    onClick={hiddenRooms.onUnlockBiometric}
                                    className="px-3 py-2 text-sm bg-purple-500/20 text-purple-200 rounded-md hover:bg-purple-500/30"
                                >
                                    Биометрия
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={hiddenRooms.onUnlockPin}
                                className="px-3 py-2 text-sm bg-accent text-text-inverted rounded-md hover:bg-accent/90"
                            >
                                Разблокировать
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {invite.isOpen && (
                <InviteUserModal
                    isOpen={invite.isOpen}
                    onClose={invite.onClose}
                    onInvite={invite.onInvite}
                    roomName={invite.roomName}
                />
            )}

            {forwarding.message && (
                <ForwardMessageModal
                    isOpen={Boolean(forwarding.message)}
                    onClose={forwarding.onClose}
                    onForward={forwarding.onForward}
                    rooms={forwarding.rooms.filter(room => room.roomId !== forwarding.currentRoomId)}
                    message={forwarding.message}
                    client={forwarding.client}
                    savedMessagesRoom={forwarding.savedMessagesRoom || null}
                />
            )}

            {mediaViewer.imageUrl && (
                <ImageViewerModal
                    imageUrl={mediaViewer.imageUrl}
                    onClose={mediaViewer.onClose}
                />
            )}

            {search.isOpen && (
                <SearchModal
                    isOpen={search.isOpen}
                    onClose={search.onClose}
                    client={search.client}
                    rooms={search.rooms}
                    onSelectResult={search.onSelectResult}
                />
            )}

            <PluginCatalogModal
                isOpen={plugins.isOpen}
                onClose={plugins.onClose}
            />

            <SharedMediaPanel
                isOpen={sharedMedia.isOpen}
                onClose={sharedMedia.onClose}
                data={sharedMedia.data}
                isLoading={sharedMedia.isLoading}
                isPaginating={sharedMedia.isPaginating}
                onLoadMore={sharedMedia.onLoadMore}
                currentUserId={sharedMedia.currentUserId}
            />

            {groupCall.activeGroupCall && (
                <CallView
                    call={null}
                    client={groupCall.client}
                    onHangup={groupCall.onHangup}
                    participants={groupCall.participantViews}
                    stageState={groupCall.stageState}
                    layout={groupCall.activeGroupCall.layout}
                    onLayoutChange={groupCall.onLayoutChange}
                    showParticipantsPanel={groupCall.showParticipantsPanel}
                    onToggleParticipantsPanel={groupCall.onToggleParticipantsPanel}
                    onToggleScreenshare={groupCall.onToggleScreenshare}
                    onToggleLocalMute={groupCall.onToggleMute}
                    onToggleLocalVideo={groupCall.onToggleVideo}
                    isScreensharing={groupCall.activeGroupCall.isScreensharing}
                    isMuted={groupCall.activeGroupCall.isMuted}
                    isVideoMuted={groupCall.activeGroupCall.isVideoMuted}
                    onToggleCoWatch={groupCall.onToggleCoWatch}
                    coWatchActive={groupCall.activeGroupCall.coWatchActive}
                    headerTitle={groupCall.client.getRoom(groupCall.activeGroupCall.roomId)?.name || undefined}
                    onMuteParticipant={groupCall.onMuteParticipant}
                    onVideoParticipantToggle={groupCall.onVideoParticipantToggle}
                    onRemoveParticipant={groupCall.onRemoveParticipant}
                    onPromotePresenter={groupCall.onPromotePresenter}
                    onSpotlightParticipant={groupCall.onSpotlightParticipant}
                    onRaiseHand={groupCall.onRaiseHand}
                    onLowerHand={groupCall.onLowerHand}
                    onBringParticipantToStage={groupCall.onBringToStage}
                    onSendParticipantToAudience={groupCall.onSendToAudience}
                    localUserId={groupCall.localUserId}
                    canModerateParticipants={groupCall.canModerateParticipants}
                    coordinator={groupCallCoordinator}
                />
            )}

            {calls.activeCall && (
                <CallView
                    call={calls.activeCall}
                    onHangup={() => calls.onHangup(false)}
                    client={calls.client}
                    callSession={calls.callSession}
                    onHandover={calls.onHandover}
                    localDeviceId={calls.localDeviceId}
                />
            )}

            {calls.incomingCall && (
                <IncomingCallModal
                    call={calls.incomingCall}
                    onAccept={calls.onAccept}
                    onDecline={calls.onDecline}
                    client={calls.client}
                />
            )}

            {groupCallPermission.error && (
                <div className="fixed bottom-6 right-6 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-3">
                    <span>{groupCallPermission.error}</span>
                    <button
                        type="button"
                        className="text-sm font-semibold uppercase tracking-wide"
                        onClick={groupCallPermission.onDismiss}
                    >
                        Закрыть
                    </button>
                </div>
            )}
        </>
    );
};

const ChatPage: React.FC<ChatPageProps> = ({ client: providedClient, onLogout, savedMessagesRoomId: savedRoomIdProp }) => {
    const activeRuntime = useAccountStore(state => (state.activeKey ? state.accounts[state.activeKey] : null));
    const removeAccount = useAccountStore(state => state.removeAccount);
    const setAccountRoomNotificationMode = useAccountStore(state => state.setRoomNotificationMode);
    const accountRoomNotificationModes = useAccountStore(state => (state.activeKey ? (state.accounts[state.activeKey]?.roomNotificationModes ?? {}) : {}));
    const activeAccountKey = useAccountStore(state => state.activeKey);
    const activeCalls = useAccountStore(state => state.activeCalls);
    const client = (providedClient ?? activeRuntime?.client)!;
    const [presenceState, dispatchPresence] = useReducer(presenceReducer, new Map<string, PresenceEventContent>());
    const currentUserId = client.getUserId?.() ?? null;
    const savedMessagesRoomId = savedRoomIdProp ?? activeRuntime?.savedMessagesRoomId ?? '';
    const logout = onLogout ?? (() => { void removeAccount(); });
    const { accounts: accountList, activeKey: activeAccountKey, setActiveKey: switchAccount, openAddAccount } = useAccountListSnapshot();
    const [isPresenceHidden, setIsPresenceHidden] = useState<boolean>(() => {
        if (!currentUserId) return false;
        try {
            return localStorage.getItem(`matrix-presence-hidden:${currentUserId}`) === 'true';
        } catch (err) {
            console.warn('Failed to read presence preference', err);
            return false;
        }
    });
    const [rooms, setRooms] = useState<UIRoom[]>([]);
    const [isRoomsLoading, setIsRoomsLoading] = useState(true);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
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
    const [isManageFoldersOpen, setIsManageFoldersOpen] = useState(false);
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [isViewScheduledModalOpen, setIsViewScheduledModalOpen] = useState(false);
    const [contentToSchedule, setContentToSchedule] = useState<DraftContent | null>(null);
    const [allScheduledMessages, setAllScheduledMessages] = useState<ScheduledMessage[]>([]);
    const [animatedReactionsEnabled, setAnimatedReactionsEnabledState] = useState<boolean>(() => isAnimatedReactionsEnabled());
    const digestState = useDigestStore(state => ({
        digestMap: state.digestMap,
        generatingRooms: state.generatingRooms,
        isHydrated: state.isHydrated,
    }));
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
    const clientAccountKey = useMemo(() => (client ? resolveAccountKeyFromClient(client) : null), [client]);
    const effectiveAccountKey = clientAccountKey ?? activeAccountKey ?? null;
    const accountCallSession = useMemo<CallSessionState | null>(() => {
        if (!effectiveAccountKey) {
            return null;
        }
        return activeCalls[effectiveAccountKey] ?? null;
    }, [effectiveAccountKey, activeCalls]);
    const roomCallSession = useMemo<CallSessionState | null>(() => {
        if (!selectedRoomId) {
            return null;
        }
        return accountCallSession && accountCallSession.roomId === selectedRoomId ? accountCallSession : null;
    }, [accountCallSession, selectedRoomId]);
    const localDeviceId = useMemo(() => {
        try {
            return client?.getDeviceId?.() ?? null;
        } catch {
            return null;
        }
    }, [client]);
    const publishCallSession = useCallback((call: MatrixCall, status: 'ringing' | 'connecting' | 'connected' | 'ended') => {
        if (!client) {
            return;
        }
        if (status === 'ended') {
            setCallSessionForClient(client, null);
            return;
        }
        const baseline = effectiveAccountKey ? getCallSessionForAccount(effectiveAccountKey) ?? accountCallSession : accountCallSession;
        const snapshot = buildCallSessionSnapshot(client, call, status, baseline ?? undefined);
        setCallSessionForClient(client, snapshot);
    }, [client, effectiveAccountKey, accountCallSession]);
    // Group call state
    const [activeGroupCall, setActiveGroupCall] = useState<{
        roomId: string;
        sessionId: string;
        url: string;
        layout: CallLayout;
        isScreensharing: boolean;
        isMuted: boolean;
        isVideoMuted: boolean;
        coWatchActive: boolean;
    } | null>(null);
    const [groupCallCoordinator, setGroupCallCoordinator] = useState<GroupCallCoordinator | null>(null);
    const [groupParticipants, setGroupParticipants] = useState<GroupCallParticipant[]>([]);
    const [stageState, setStageState] = useState<GroupCallStageState | null>(null);
    const [showParticipantsPanel, setShowParticipantsPanel] = useState(false);
    const [spotlightParticipantId, setSpotlightParticipantId] = useState<string | null>(null);
    const previousParticipantIdsRef = useRef<Set<string>>(new Set());
    const previousHandRaiseRef = useRef<Set<string>>(new Set());
    const handRaiseQueueRef = useRef<string[]>([]);
    const [groupCallPermissionError, setGroupCallPermissionError] = useState<string | null>(null);
    const stories = useStoryStore<Story[]>(state => state.stories);
    const storiesHydrated = useStoryStore(state => state.isHydrated);
    const [activeStoryAuthorId, setActiveStoryAuthorId] = useState<string | null>(null);
    const [activeStoryIndex, setActiveStoryIndex] = useState(0);
    const [isStoryViewerOpen, setIsStoryViewerOpen] = useState(false);

    const normalisePresenceContent = useCallback((content: PresenceEventContent): PresenceEventContent => {
        const enriched: PresenceEventContent = { ...content };
        if (typeof enriched.last_active_ts !== 'number' && typeof enriched.last_active_ago === 'number') {
            enriched.last_active_ts = Date.now() - enriched.last_active_ago;
        }
        if (typeof enriched.user_id !== 'string' && typeof (content as { user_id?: string })?.user_id === 'string') {
            enriched.user_id = (content as { user_id?: string }).user_id;
        }
        return enriched;
    }, []);

    const upsertPresence = useCallback((userId: string | undefined, content: PresenceEventContent | undefined) => {
        if (!userId || !content) return;
        if (userId === currentUserId) {
            if (isPresenceHidden) {
                dispatchPresence({ type: 'remove', userId });
            }
            return;
        }
        dispatchPresence({ type: 'replace', userId, content: normalisePresenceContent(content) });
    }, [currentUserId, dispatchPresence, isPresenceHidden, normalisePresenceContent]);

    const storyGroups = useMemo(() => {
        if (!stories || stories.length === 0) {
            return [] as Array<{ authorId: string; authorDisplayName?: string; stories: Story[] }>;
        }
        const map = new Map<string, { authorId: string; authorDisplayName?: string; stories: Story[] }>();
        stories.forEach(story => {
            const entry = map.get(story.authorId);
            if (entry) {
                entry.stories.push(story);
                if (!entry.authorDisplayName && story.authorDisplayName) {
                    entry.authorDisplayName = story.authorDisplayName;
                }
            } else {
                map.set(story.authorId, {
                    authorId: story.authorId,
                    authorDisplayName: story.authorDisplayName,
                    stories: [story],
                });
            }
        });
        return Array.from(map.values())
            .map(group => ({
                ...group,
                stories: [...group.stories].sort((a, b) => b.createdAt - a.createdAt),
            }))
            .sort((a, b) => (b.stories[0]?.createdAt ?? 0) - (a.stories[0]?.createdAt ?? 0));
    }, [stories]);

    const activeStoryGroup = useMemo(() => storyGroups.find(group => group.authorId === activeStoryAuthorId) ?? null, [storyGroups, activeStoryAuthorId]);

    useEffect(() => {
        if (!groupCallPermissionError) return;
        const timer = window.setTimeout(() => setGroupCallPermissionError(null), 5000);
        return () => window.clearTimeout(timer);
    }, [groupCallPermissionError]);

    useEffect(() => {
        if (!isStoryViewerOpen) {
            return;
        }
        if (!activeStoryGroup) {
            setIsStoryViewerOpen(false);
            setActiveStoryIndex(0);
            return;
        }
        if (activeStoryIndex >= activeStoryGroup.stories.length) {
            setActiveStoryIndex(0);
        }
    }, [isStoryViewerOpen, activeStoryGroup, activeStoryIndex]);

    const handleOpenStory = useCallback((authorId: string, index: number) => {
        setActiveStoryAuthorId(authorId);
        setActiveStoryIndex(index);
        setIsStoryViewerOpen(true);
    }, []);

    const handleCloseStoryViewer = useCallback(() => {
        setIsStoryViewerOpen(false);
    }, []);

    const handleStorySeen = useCallback((storyId: string) => {
        void markActiveStoryAsRead(storyId);
    }, []);

    const handleStoryReaction = useCallback((storyId: string, emoji: string) => {
        void toggleActiveStoryReaction(storyId, emoji);
    }, []);

    const handleStoryNext = useCallback(() => {
        if (!activeStoryGroup) {
            setIsStoryViewerOpen(false);
            return;
        }
        setActiveStoryIndex(prevIndex => {
            if (prevIndex < activeStoryGroup.stories.length - 1) {
                return prevIndex + 1;
            }
            const currentGroupIndex = storyGroups.findIndex(group => group.authorId === activeStoryGroup.authorId);
            if (currentGroupIndex >= 0 && currentGroupIndex < storyGroups.length - 1) {
                const nextGroup = storyGroups[currentGroupIndex + 1];
                setActiveStoryAuthorId(nextGroup.authorId);
                return 0;
            }
            setIsStoryViewerOpen(false);
            return prevIndex;
        });
    }, [activeStoryGroup, storyGroups]);

    const handleStoryPrevious = useCallback(() => {
        if (!activeStoryGroup) {
            setIsStoryViewerOpen(false);
            return;
        }
        setActiveStoryIndex(prevIndex => {
            if (prevIndex > 0) {
                return prevIndex - 1;
            }
            const currentGroupIndex = storyGroups.findIndex(group => group.authorId === activeStoryGroup.authorId);
            if (currentGroupIndex > 0) {
                const previousGroup = storyGroups[currentGroupIndex - 1];
                setActiveStoryAuthorId(previousGroup.authorId);
                return Math.max(previousGroup.stories.length - 1, 0);
            }
            setIsStoryViewerOpen(false);
            return prevIndex;
        });
    }, [activeStoryGroup, storyGroups]);

    useEffect(() => {
        if (!currentUserId) {
            dispatchPresence({ type: 'clear' });
            setIsPresenceHidden(false);
            return;
        }
        try {
            const stored = localStorage.getItem(`matrix-presence-hidden:${currentUserId}`) === 'true';
            setIsPresenceHidden(prev => (prev === stored ? prev : stored));
        } catch (err) {
            console.warn('Failed to synchronise presence preference', err);
            setIsPresenceHidden(false);
        }
        dispatchPresence({ type: 'clear' });
    }, [currentUserId, dispatchPresence]);

    useEffect(() => {
        if (!currentUserId) return;
        try {
            localStorage.setItem(`matrix-presence-hidden:${currentUserId}`, isPresenceHidden ? 'true' : 'false');
        } catch (err) {
            console.warn('Failed to persist presence preference', err);
        }
    }, [currentUserId, isPresenceHidden]);

    useEffect(() => {
        if (!currentUserId) return;
        if (!isPresenceHidden) return;
        dispatchPresence({ type: 'remove', userId: currentUserId });
    }, [currentUserId, isPresenceHidden, dispatchPresence]);

    useEffect(() => {
        if (!currentUserId) return;
        const applyPresence = async () => {
            if (typeof (client as any).setPresence !== 'function') return;
            try {
                await (client as any).setPresence(isPresenceHidden ? 'offline' : 'online');
            } catch (err) {
                console.warn('Failed to apply presence preference', err);
            }
        };
        void applyPresence();
    }, [client, currentUserId, isPresenceHidden]);

    useEffect(() => {
        const onPresence = (event: MatrixEvent, user?: MatrixUser) => {
            const content = event.getContent() as PresenceEventContent | undefined;
            const sender = user?.userId ?? event.getSender?.() ?? (content?.user_id as string | undefined);
            upsertPresence(sender, content);
        };

        client.on(UserEvent.Presence, onPresence as any);
        return () => {
            client.removeListener(UserEvent.Presence, onPresence as any);
        };
    }, [client, upsertPresence]);
    const [incomingCall, setIncomingCall] = useState<MatrixCall | null>(null);
    const [translatedMessages, setTranslatedMessages] = useState<Record<string, { text: string; isLoading: boolean }>>({});
    const [chatBackground, setChatBackground] = useState<string>('');
    const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
        return localStorage.getItem('matrix-notifications-enabled') === 'true';
    });
    const [sendKeyBehavior, setSendKeyBehavior] = useState<SendKeyBehavior>(() => {
        const stored = localStorage.getItem('matrix-send-key') as SendKeyBehavior | null;
        return stored === 'ctrlEnter' || stored === 'altEnter' || stored === 'enter' ? stored : 'enter';
    });
    const [isOffline, setIsOffline] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [verificationRequests, setVerificationRequests] = useState<any[]>([]);
    const [secureCloudAlerts, setSecureCloudAlerts] = useState<Record<string, SuspiciousEventNotice[]>>({});
    const [secureCloudError, setSecureCloudError] = useState<string | null>(null);
    const [secureCloudProfile, setSecureCloudProfile] = useState<SecureCloudProfile | null>(() => {
        const profile = getSecureCloudProfileForClient(client);
        return profile ? normaliseSecureCloudProfile(profile) : null;
    });
    const [isSecureCloudActive, setIsSecureCloudActive] = useState(false);
    const [isSharedMediaOpen, setIsSharedMediaOpen] = useState(false);
    const [sharedMediaData, setSharedMediaData] = useState<RoomMediaSummary | null>(null);
    const [isSharedMediaLoading, setIsSharedMediaLoading] = useState(false);
    const [isSharedMediaPaginating, setIsSharedMediaPaginating] = useState(false);
    const [isPluginCatalogOpen, setIsPluginCatalogOpen] = useState(false);
    const [outboxItems, setOutboxItems] = useState<Record<string, { payload: OutboxPayload; attempts: number; error?: string; progress?: OutboxProgressState }>>({});
    const [currentSelfDestructSeconds, setCurrentSelfDestructSeconds] = useState<number | null>(null);
    const [appLockState, setAppLockState] = useState<{ enabled: boolean; biometricEnabled: boolean; unlocked: boolean }>(() => ({
        enabled: false,
        biometricEnabled: false,
        unlocked: isSessionUnlocked(),
    }));
    const [isPinPromptOpen, setIsPinPromptOpen] = useState(false);
    const [pinInput, setPinInput] = useState('');
    const [pinError, setPinError] = useState<string | null>(null);
    const [pendingHiddenRoomId, setPendingHiddenRoomId] = useState<string | null>(null);
    const [hiddenRoomIds, setHiddenRoomIds] = useState<string[]>([]);
    const [highlightedMessage, setHighlightedMessage] = useState<{ roomId: string; eventId: string } | null>(null);
    const [pendingScrollTarget, setPendingScrollTarget] = useState<{ roomId: string; eventId: string } | null>(null);
    const normalizeAttachments = (attachments: unknown): DraftAttachment[] => {
        if (!Array.isArray(attachments)) return [];

        const toString = (value: unknown): string | undefined =>
            typeof value === 'string' && value.length > 0 ? value : undefined;
        const toNumber = (value: unknown): number | undefined => {
            if (typeof value === 'number' && !Number.isNaN(value)) return value;
            if (typeof value === 'string') {
                const parsed = Number(value);
                if (!Number.isNaN(parsed)) return parsed;
            }
            return undefined;
        };

        return attachments.flatMap((item, index) => {
            if (!item || typeof item !== 'object') return [];
            const record = item as Record<string, unknown> & {
                info?: Record<string, unknown>;
                metadata?: Record<string, unknown>;
            };

            const id = toString(record.id) ?? `attachment_${Date.now()}_${index}`;
            const name = toString(record.name) ?? toString(record.body) ?? 'attachment';

            const info = record.info ?? {};
            const metadata = record.metadata ?? {};

            const mimeType = toString(record.mimeType)
                ?? toString(info?.mimetype)
                ?? toString(metadata?.mimeType)
                ?? 'application/octet-stream';

            const size = toNumber(record.size)
                ?? toNumber(metadata?.size)
                ?? 0;

            const explicitKind = toString(record.kind);
            const inferredKind: DraftAttachmentKind = explicitKind && ATTACHMENT_KINDS.includes(explicitKind as DraftAttachmentKind)
                ? explicitKind as DraftAttachmentKind
                : mimeType.startsWith('image/')
                    ? 'image'
                    : mimeType.startsWith('audio/')
                        ? 'audio'
                        : 'file';

            const attachment: DraftAttachment = {
                id,
                name,
                size,
                mimeType,
                kind: inferredKind,
            };

            const dataUrl = toString(record.dataUrl);
            if (dataUrl) attachment.dataUrl = dataUrl;

            const tempUrl = toString(record.tempUrl) ?? toString((record as any).blobUrl);
            if (tempUrl) attachment.tempUrl = tempUrl;

            const url = toString(record.url);
            if (url) attachment.url = url;

            const thumbnailUrl = toString((record as any).thumbnailUrl) ?? toString((record as any).previewUrl);
            if (thumbnailUrl) attachment.thumbnailUrl = thumbnailUrl;

            const width = toNumber(record.width) ?? toNumber(info?.w);
            if (typeof width === 'number') attachment.width = width;

            const height = toNumber(record.height) ?? toNumber(info?.h);
            if (typeof height === 'number') attachment.height = height;

            const duration = toNumber(record.duration) ?? toNumber(info?.duration);
            if (typeof duration === 'number') attachment.duration = duration;

            const waveformSource = Array.isArray((record as any).waveform)
                ? (record as any).waveform
                : Array.isArray(metadata?.waveform)
                    ? metadata.waveform
                    : undefined;
            if (Array.isArray(waveformSource)) {
                const waveform = waveformSource
                    .map(entry => (typeof entry === 'number' ? entry : Number(entry)))
                    .filter(entry => typeof entry === 'number' && !Number.isNaN(entry));
                if (waveform.length > 0) {
                    attachment.waveform = waveform;
                }
            }

            const body = toString(record.body);
            if (body) attachment.body = body;

            const msgtype = toString(record.msgtype);
            if (msgtype) attachment.msgtype = msgtype;

            return [attachment];
        });
    };

    useEffect(() => {
        const initialiseAppLock = async () => {
            try {
                await ensureAppLockConsistency();
                const snapshot = await getAppLockSnapshot();
                setAppLockState({
                    enabled: snapshot.enabled,
                    biometricEnabled: snapshot.biometricEnabled,
                    unlocked: snapshot.enabled ? isSessionUnlocked() : true,
                });
            } catch (error) {
                console.warn('Failed to load app lock snapshot', error);
            }
        };
        void initialiseAppLock();
    }, []);

    useEffect(() => {
        if (!isSettingsOpen) {
            const refreshSnapshot = async () => {
                try {
                    const snapshot = await getAppLockSnapshot();
                    setAppLockState(prev => ({
                        enabled: snapshot.enabled,
                        biometricEnabled: snapshot.biometricEnabled,
                        unlocked: snapshot.enabled ? isSessionUnlocked() : true,
                    }));
                } catch (error) {
                    console.warn('Failed to refresh app lock snapshot', error);
                }
            };
            void refreshSnapshot();
        }
    }, [isSettingsOpen]);

    const describeTimer = useCallback((seconds: number | null): string => {
        if (!seconds) return 'отключено';
        if (seconds < 60) return `${seconds} секунд`;
        if (seconds < 3600) {
            const minutes = Math.round(seconds / 60);
            return `${minutes} минут`;
        }
        if (seconds < 86400) {
            const hours = Math.round(seconds / 3600);
            return `${hours} часов`;
        }
        const days = Math.round(seconds / 86400);
        return `${days} дней`;
    }, []);

    const notifyTimerChange = useCallback(async (seconds: number | null) => {
        if (!selectedRoomId) return;
        const description = describeTimer(seconds);
        const body = seconds
            ? `🔒 Автоудаление сообщений включено: ${description}.`
            : '🔓 Автоудаление сообщений отключено.';
        try {
            await client.sendEvent(selectedRoomId, EventType.RoomMessage, {
                msgtype: MsgType.Notice,
                body,
            } as any);
        } catch (error) {
            console.warn('Failed to broadcast timer change', error);
        }
    }, [client, describeTimer, selectedRoomId]);

    const serializeAttachmentForComparison = (attachment: DraftAttachment) => ({
        id: attachment.id,
        name: attachment.name,
        size: attachment.size,
        mimeType: attachment.mimeType,
        kind: attachment.kind,
        dataUrl: attachment.dataUrl ?? null,
        tempUrl: attachment.tempUrl ?? null,
        url: attachment.url ?? null,
        thumbnailUrl: attachment.thumbnailUrl ?? null,
        width: attachment.width ?? null,
        height: attachment.height ?? null,
        duration: attachment.duration ?? null,
        waveform: attachment.waveform ?? null,
        body: attachment.body ?? null,
        msgtype: attachment.msgtype ?? null,
    });

    const areAttachmentsEqual = (a: DraftAttachment[], b: DraftAttachment[]) => {
        if (a.length !== b.length) return false;
        return a.every((att, index) => {
            const other = b[index];
            if (!other) return false;
            return JSON.stringify(serializeAttachmentForComparison(att))
                === JSON.stringify(serializeAttachmentForComparison(other));
        });
    };

    const formatOutboxError = useCallback((error: unknown): string => {
        if (!error) return 'Неизвестная ошибка';
        if (error instanceof Error) return error.message;
        if (typeof error === 'string') return error;
        if (typeof (error as any)?.message === 'string') return (error as any).message;
        try {
            return JSON.stringify(error);
        } catch {
            return 'Неизвестная ошибка';
        }
    }, []);

    const deriveOutboxProgress = useCallback((payload: OutboxPayload): OutboxProgressState | undefined => {
        if (!Array.isArray(payload.attachments) || payload.attachments.length === 0) {
            return undefined;
        }
        const totalBytes = payload.attachments.reduce((sum, attachment) => sum + (attachment?.size ?? 0), 0);
        if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
            return undefined;
        }
        const uploadedBytes = payload.attachments.reduce((sum, attachment) => sum + (attachment?.checkpoint?.uploadedBytes ?? 0), 0);
        return {
            totalBytes,
            uploadedBytes: Math.min(uploadedBytes, totalBytes),
        };
    }, []);

    const normalizeDraft = (value: unknown): DraftContent => {
        if (value && typeof value === 'object') {
            const draft = value as Record<string, unknown>;
            const plain = typeof draft.plain === 'string'
                ? draft.plain
                : typeof draft.content === 'string'
                    ? draft.content
                    : '';
            const formatted = typeof draft.formatted === 'string' ? draft.formatted : undefined;
            const msgtype = typeof draft.msgtype === 'string' ? draft.msgtype : undefined;
            const attachments = normalizeAttachments(draft.attachments);
            return { plain, formatted, attachments, msgtype };
        }
        if (typeof value === 'string') {
            return { plain: value, formatted: undefined, attachments: [], msgtype: MsgType.Text };
        }
        return { plain: '', formatted: undefined, attachments: [], msgtype: undefined };
    };

    const [drafts, setDrafts] = useState<Record<string, DraftContent>>(() => {
        try {
            const storedDrafts = localStorage.getItem(DRAFT_STORAGE_KEY);
            if (storedDrafts) {
                const parsed = JSON.parse(storedDrafts);
                if (parsed && typeof parsed === 'object') {
                    return Object.entries(parsed).reduce<Record<string, DraftContent>>((acc, [roomId, value]) => {
                        acc[roomId] = normalizeDraft(value);
                        return acc;
                    }, {});
                }
            }
        } catch (error) {
            console.error('Failed to parse stored drafts from localStorage', error);
        }
        return {};
    });

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const oldScrollHeightRef = useRef<number>(0);
    const focusEventIdRef = useRef<string | null>(null);
    const secureSessionRef = useRef<SecureCloudSession | null>(null);
    const sharedMediaEventIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        setRoomNotificationPreferences(accountRoomNotificationModes);
    }, [accountRoomNotificationModes]);

    const formatDetectorStatus = useCallback((state: SecureCloudDetectorState): string => {
        if (!state.enabled && !state.detector.required) {
            return 'Отключен пользователем';
        }
        const status = detectorStatuses[state.detector.id];
        if (!status) {
            return state.detector.required ? 'Активен' : 'Готов';
        }
        switch (status.state) {
            case 'loading':
                return status.detail ?? 'Загрузка…';
            case 'error':
                return `Ошибка: ${status.detail ?? 'подробности недоступны'}`;
            case 'idle':
                return status.detail ?? 'Ожидает активации';
            case 'ready':
            default:
                return status.detail ?? 'Готов';
        }
    }, [detectorStatuses]);

    const handleSecureCloudDetectorError = useCallback((error: Error) => {
        setSecureCloudError(error.message);
        const detectorMatch = error.message.match(/^Secure Cloud detector (.+?) failed: (.+)$/);
        if (detectorMatch) {
            const [, detectorId, detail] = detectorMatch;
            setDetectorStatuses(prev => ({
                ...prev,
                [detectorId]: { state: 'error', detail },
            }));
        }
    }, []);

    const handleToggleDetector = useCallback((detectorId: string, enabled: boolean) => {
        setSecureCloudProfile(prev => {
            if (!prev) {
                return prev;
            }
            const normalised = normaliseSecureCloudProfile(prev);
            const detectors = (normalised.detectors ?? []).map(state => {
                if (state.detector.id !== detectorId) {
                    return state;
                }
                if (state.detector.required) {
                    return { ...state, enabled: true };
                }
                return { ...state, enabled };
            });
            const nextProfile = normaliseSecureCloudProfile({ ...normalised, detectors });
            setSecureCloudProfileForClient(client, nextProfile);
            secureSessionRef.current?.updateProfile(nextProfile);
            return nextProfile;
        });

        setDetectorStatuses(prev => {
            if (enabled) {
                const { [detectorId]: _, ...rest } = prev;
                return rest;
            }
            return { ...prev, [detectorId]: { state: 'idle', detail: 'Отключен пользователем' } };
        });
    }, [client]);

    const handleUpdateDetectorConfig = useCallback((detectorId: string, patch: SecureCloudDetectorConfig) => {
        setSecureCloudProfile(prev => {
            if (!prev) {
                return prev;
            }
            const normalised = normaliseSecureCloudProfile(prev);
            const detectors = (normalised.detectors ?? []).map(state => {
                if (state.detector.id !== detectorId) {
                    return state;
                }
                const mergedConfig: SecureCloudDetectorConfig = {
                    ...(state.detector.defaultConfig ?? {}),
                    ...(state.config ?? {}),
                    ...patch,
                };
                return { ...state, config: mergedConfig };
            });
            const nextProfile = normaliseSecureCloudProfile({ ...normalised, detectors });
            setSecureCloudProfileForClient(client, nextProfile);
            secureSessionRef.current?.updateProfile(nextProfile);
            return nextProfile;
        });
    }, [client]);

    useEffect(() => {
        try {
            const serialized = Object.entries(drafts).reduce<Record<string, DraftContent>>((acc, [roomId, draft]) => {
                acc[roomId] = draft;
                return acc;
            }, {});
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(serialized));
        } catch (error) {
            console.error('Failed to persist drafts to localStorage', error);
        }
    }, [drafts]);

    useEffect(() => {
        try {
            localStorage.setItem('matrix-send-key', sendKeyBehavior);
        } catch (error) {
            console.error('Failed to persist send key behavior', error);
        }
    }, [sendKeyBehavior]);

    useEffect(() => {
        if (!client || !selectedRoomId) {
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const mode = await getRoomNotificationMode(client, selectedRoomId);
                if (cancelled) {
                    return;
                }
                setAccountRoomNotificationMode(selectedRoomId, mode, activeRuntime?.creds.key ?? null);
                setRoomNotificationPreference(selectedRoomId, mode);
            } catch (error) {
                console.error('Failed to load room notification mode', error);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [client, selectedRoomId, activeRuntime?.creds.key, setAccountRoomNotificationMode]);

    useEffect(() => {
        const profile = getSecureCloudProfileForClient(client);
        if (!profile || profile.mode === 'disabled') {
            setIsSecureCloudActive(false);
            setSecureCloudAlerts({});
            setDetectorStatuses({});
            setSecureCloudProfile(null);
            secureSessionRef.current?.stop();
            secureSessionRef.current = null;
            return;
        }

        const normalisedProfile = normaliseSecureCloudProfile(profile);
        setSecureCloudProfile(normalisedProfile);
        setSecureCloudProfileForClient(client, normalisedProfile);
        setIsSecureCloudActive(true);
        setSecureCloudError(null);
        setSecureCloudAlerts({});

        const session = startSecureCloudSession(client, normalisedProfile, {
            onSuspiciousEvent: (notice) => {
                setSecureCloudAlerts(prev => {
                    const roomAlerts = prev[notice.roomId] ?? [];
                    if (roomAlerts.some(existing => existing.eventId === notice.eventId)) {
                        return prev;
                    }
                    return { ...prev, [notice.roomId]: [...roomAlerts, notice] };
                });
            },
            onError: handleSecureCloudDetectorError,
        });

        secureSessionRef.current?.stop();
        secureSessionRef.current = session;

        return () => {
            session.stop();
            if (secureSessionRef.current === session) {
                secureSessionRef.current = null;
            }
        };
    }, [client, handleSecureCloudDetectorError]);

    useEffect(() => {
        if (!secureCloudProfile?.detectors || secureCloudProfile.detectors.length === 0) {
            setDetectorStatuses({});
            return;
        }

        let cancelled = false;

        const refreshStatuses = async () => {
            const next: Record<string, SecureCloudDetectorStatus> = {};
            for (const state of secureCloudProfile.detectors ?? []) {
                const detectorId = state.detector.id;
                if (!state.enabled && !state.detector.required) {
                    next[detectorId] = { state: 'idle', detail: 'Отключен пользователем' };
                    continue;
                }
                try {
                    const statusResult = state.detector.getStatus?.();
                    const status = statusResult instanceof Promise ? await statusResult : statusResult;
                    if (status) {
                        next[detectorId] = status;
                    } else {
                        next[detectorId] = { state: 'ready' };
                    }
                } catch (error) {
                    next[detectorId] = {
                        state: 'error',
                        detail: error instanceof Error ? error.message : 'Не удалось получить статус',
                    };
                }
            }
            if (!cancelled) {
                setDetectorStatuses(next);
            }
        };

        void refreshStatuses();

        return () => {
            cancelled = true;
        };
    }, [secureCloudProfile]);

    useEffect(() => {
        if (!client.getUserId()) {
            return;
        }

        const syncDrafts = async () => {
            try {
                await client.setAccountData(DRAFT_ACCOUNT_DATA_EVENT as any, drafts as any);
            } catch (error) {
                console.error('Failed to sync drafts to Matrix account data', error);
            }
        };

        void syncDrafts();
    }, [client, drafts]);

    // Handle notification settings
    useEffect(() => {
        localStorage.setItem('matrix-notifications-enabled', String(notificationsEnabled));
        if (!notificationsEnabled) {
            return;
        }
        const enableNotifications = async () => {
            try {
                const hasPermission = await checkPermission();
                if (!hasPermission) {
                    setNotificationsEnabled(false);
                    return;
                }
                if (isWebPushSupported()) {
                    const result = await subscribeToWebPush();
                    if (result) {
                        await registerMatrixWebPush(client, result.registration, result.subscription, {
                            accountKey: activeRuntime?.creds.key ?? null,
                        });
                    }
                }
            } catch (error) {
                console.error('Failed to enable notifications', error);
            }
        };
        void enableNotifications();
    }, [notificationsEnabled, client, activeRuntime?.creds.key]);

    // Setup notification listeners on mount
    useEffect(() => {
        setupNotificationListeners();
    }, []);

    useEffect(() => onAnimatedReactionsPreferenceChange(setAnimatedReactionsEnabledState), []);

    useEffect(() => {
        setActiveDigestAccount(activeAccountKey ?? null);
        if (activeAccountKey) {
            void hydrateDigestsForAccount(activeAccountKey).catch(error => {
                console.debug('Failed to hydrate digests for account', error);
            });
        }
    }, [activeAccountKey]);

    useEffect(() => {
        if (!activeAccountKey || rooms.length === 0) {
            return;
        }
        const counts: Record<string, number> = {};
        rooms.forEach(room => {
            counts[room.roomId] = room.unreadCount ?? 0;
        });
        void updateDigestUnreadCounts(activeAccountKey, counts).catch(error => {
            console.debug('Failed to sync digest unread counts', error);
        });
    }, [rooms, activeAccountKey]);

    useEffect(() => {
        const handleShortcut = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                const target = event.target as HTMLElement | null;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                    return;
                }
                event.preventDefault();
                setIsSearchOpen(true);
            }
        };

        window.addEventListener('keydown', handleShortcut);
        return () => window.removeEventListener('keydown', handleShortcut);
    }, []);

    // Load scheduled messages on startup
    useEffect(() => {
        let isMounted = true;

        const loadScheduled = async () => {
            try {
                const messages = await getScheduledMessages(client);
                if (isMounted) {
                    setAllScheduledMessages(messages);
                }
            } catch (error) {
                console.error('Failed to load scheduled messages from state events', error);
            }
        };

        void loadScheduled();

        const handleStateEvent = (event: MatrixEvent) => {
            if (event.getType() !== SCHEDULED_MESSAGES_EVENT_TYPE) {
                return;
            }

            const messages = applyScheduledMessagesEvent(client, event);
            if (isMounted) {
                setAllScheduledMessages(messages);
            }
        };

        client.on(RoomEvent.State, handleStateEvent);

        return () => {
            isMounted = false;
            client.removeListener(RoomEvent.State, handleStateEvent);
        };
    }, [client]);

    // Load chat background on startup
    useEffect(() => {
        const savedBg = localStorage.getItem('matrix-chat-bg');
        if (savedBg) {
            setChatBackground(savedBg);
        }
    }, []);
    // Crypto events: key backup and verification requests
    useEffect(() => {
        const onKeyBackup = (enabled: boolean) => setIsKeyBackupEnabled(enabled);
        const onVerificationRequest = (req: any) => {
            setVerificationRequests(prev => {
                if (prev.find(r => r?.getId?.() === req?.getId?.())) return prev;
                return [...prev, req];
            });
        };

        // Try to read current backup status
        try {
            Promise.resolve((client.getCrypto() as any)?.isKeyBackupEnabled?.()).then((v: any) => {
                if (typeof v === 'boolean') setIsKeyBackupEnabled(v);
            });
        } catch (_) {}

        client.on('crypto.keyBackupStatus' as any, onKeyBackup);
        client.on('crypto.verification.request' as any, onVerificationRequest);
        return () => {
            client.removeListener('crypto.keyBackupStatus' as any, onKeyBackup);
            client.removeListener('crypto.verification.request' as any, onVerificationRequest);
        };
    }, [client]);

    const { canStartGroupCall, groupCallDisabledReason } = useMemo(() => {
        if (!selectedRoomId) {
            return { canStartGroupCall: false, groupCallDisabledReason: 'Выберите комнату' };
        }
        const room = client.getRoom(selectedRoomId);
        if (!room) {
            return { canStartGroupCall: false, groupCallDisabledReason: 'Комната недоступна' };
        }
        try {
            const maySend = room.currentState?.maySendStateEvent?.(GROUP_CALL_STATE_EVENT_TYPE as any, client.getUserId() || '');
            return { canStartGroupCall: Boolean(maySend), groupCallDisabledReason: maySend ? null : 'Недостаточно прав для запуска группового звонка' };
        } catch (error) {
            console.warn('Failed to evaluate group call permissions', error);
            return { canStartGroupCall: true, groupCallDisabledReason: null };
        }
    }, [client, selectedRoomId]);

// ===== Group call handlers =====
const handleStartGroupCall = useCallback(async () => {
    if (!selectedRoomId) return;
    if (!canStartGroupCall) {
        setGroupCallPermissionError(groupCallDisabledReason || 'Недостаточно прав для запуска группового звонка');
        return;
    }
    try {
        const roomName = client.getRoom(selectedRoomId)?.name;
        const result = await startGroupCall(client, selectedRoomId, { sfuKind: 'cascade', topic: roomName });
        const localUserId = client.getUserId() || 'unknown';
        const localUser = client.getUser(localUserId);
        const coordinator = await createGroupCallCoordinator(client, selectedRoomId, result.sessionId, {
            userId: localUserId,
            displayName: localUser?.displayName || localUserId,
            avatarUrl: localUser?.avatarUrl ?? null,
            role: 'host',
        }, { constraints: { audio: true, video: true } });
        setGroupCallCoordinator(coordinator);
        setGroupParticipants(coordinator.getParticipants());
        const stageSnapshot = coordinator.getStageState();
        setStageState(stageSnapshot);
        handRaiseQueueRef.current = stageSnapshot.handRaiseQueue;
        previousHandRaiseRef.current = new Set(stageSnapshot.handRaiseQueue);
        const localParticipant = coordinator.getParticipants().find(p => p.userId === localUserId);
        setActiveGroupCall({
            roomId: selectedRoomId,
            sessionId: result.sessionId,
            url: result.url,
            layout: 'grid',
            isScreensharing: Boolean(localParticipant?.isScreensharing),
            isMuted: Boolean(localParticipant?.isMuted),
            isVideoMuted: Boolean(localParticipant?.isVideoMuted),
            coWatchActive: false,
        });
        setShowParticipantsPanel(true);
        if (notificationsEnabled) {
            sendNotification('Групповой звонок', roomName ? `Комната: ${roomName}` : 'Вы начали групповой звонок', { roomId: selectedRoomId });
        }
    } catch (error) {
        console.error('Failed to start group call', error);
    }
}, [selectedRoomId, canStartGroupCall, groupCallDisabledReason, client, notificationsEnabled]);

const handleToggleScreenShare = useCallback(async () => {
    if (!groupCallCoordinator) return;
    try {
        await groupCallCoordinator.toggleScreenshare();
    } catch (error) {
        console.error('Screen share failed', error);
    }
}, [groupCallCoordinator]);

const handleGroupMuteToggle = useCallback(() => {
    void groupCallCoordinator?.toggleMute();
}, [groupCallCoordinator]);

const handleGroupVideoToggle = useCallback(() => {
    void groupCallCoordinator?.toggleVideo();
}, [groupCallCoordinator]);

const handleToggleCoWatch = useCallback(() => {
    void groupCallCoordinator?.toggleCoWatch();
}, [groupCallCoordinator]);

const handleCloseGroupCall = useCallback(() => {
    if (activeGroupCall) {
        void leaveGroupCallCoordinator(activeGroupCall.roomId, activeGroupCall.sessionId);
    }
    setActiveGroupCall(null);
    setGroupCallCoordinator(null);
    setGroupParticipants([]);
    setStageState(null);
    setShowParticipantsPanel(false);
    previousParticipantIdsRef.current.clear();
    previousHandRaiseRef.current = new Set();
    handRaiseQueueRef.current = [];
    setSpotlightParticipantId(null);
}, [activeGroupCall]);

const handleLayoutChange = useCallback((nextLayout: CallLayout) => {
    setActiveGroupCall(prev => (prev ? { ...prev, layout: nextLayout } : prev));
}, []);

const handleMuteParticipant = useCallback((participantId: string) => {
    if (!groupCallCoordinator) return;
    groupCallCoordinator.setParticipantMuted(participantId, true);
}, [groupCallCoordinator]);

const handleVideoParticipantToggle = useCallback((participantId: string) => {
    if (!groupCallCoordinator) return;
    groupCallCoordinator.setParticipantVideoMuted(participantId, true);
}, [groupCallCoordinator]);

const handleRemoveParticipant = useCallback((participantId: string) => {
    if (!groupCallCoordinator) return;
    void groupCallCoordinator.kickParticipant(participantId);
}, [groupCallCoordinator]);

const handlePromotePresenter = useCallback((participantId: string) => {
    if (!groupCallCoordinator) return;
    groupCallCoordinator.promoteParticipant(participantId);
}, [groupCallCoordinator]);

const handleSpotlightParticipant = useCallback((participantId: string) => {
    setSpotlightParticipantId(participantId);
    setActiveGroupCall(prev => (prev ? { ...prev, layout: 'spotlight' } : prev));
}, []);

const handleRaiseHand = useCallback(() => {
    groupCallCoordinator?.raiseHand();
}, [groupCallCoordinator]);

const handleLowerHand = useCallback((participantId?: string) => {
    if (!groupCallCoordinator) return;
    if (participantId) {
        groupCallCoordinator.lowerHand(participantId);
    } else {
        groupCallCoordinator.lowerHand();
    }
}, [groupCallCoordinator]);

const handleBringParticipantToStage = useCallback((participantId: string) => {
    if (!groupCallCoordinator) return;
    groupCallCoordinator.bringParticipantToStage(participantId);
    if (activeGroupCall) {
        const participant = groupParticipants.find(p => p.userId === participantId);
        notifyStageInvite({
            roomId: activeGroupCall.roomId,
            sessionId: activeGroupCall.sessionId,
            userId: participantId,
            displayName: participant?.displayName ?? participantId,
            inviterId: client.getUserId() ?? undefined,
            reason: 'invite',
        });
    }
}, [groupCallCoordinator, activeGroupCall, groupParticipants, client]);

const handleSendParticipantToAudience = useCallback((participantId: string) => {
    if (!groupCallCoordinator) return;
    groupCallCoordinator.moveParticipantToAudience(participantId);
}, [groupCallCoordinator]);
// ===== end group call handlers =====

    useEffect(() => {
        if (!groupCallCoordinator) return;
        const offParticipants = groupCallCoordinator.on('participants-changed', list => {
            setGroupParticipants(list);
            const localId = client.getUserId();
            const localParticipant = localId ? list.find(p => p.userId === localId) : undefined;
            setActiveGroupCall(prev => (prev && prev.sessionId === groupCallCoordinator.sessionId)
                ? {
                    ...prev,
                    isMuted: Boolean(localParticipant?.isMuted),
                    isVideoMuted: Boolean(localParticipant?.isVideoMuted),
                    isScreensharing: Boolean(localParticipant?.isScreensharing),
                }
                : prev);
            setStageState(groupCallCoordinator.getStageState());
            handRaiseQueueRef.current = groupCallCoordinator.getHandRaiseQueue();
            if (notificationsEnabled) {
                const previous = previousParticipantIdsRef.current;
                const next = new Set<string>();
                list.forEach(participant => {
                    next.add(participant.userId);
                    if (!previous.has(participant.userId) && participant.userId !== localId) {
                        sendNotification('Новый участник звонка', participant.displayName ?? participant.userId, { roomId: activeGroupCall?.roomId });
                    }
                });
                previousParticipantIdsRef.current = next;
            } else {
                previousParticipantIdsRef.current = new Set(list.map(p => p.userId));
            }
        });
        const offScreenshare = groupCallCoordinator.on('screenshare-changed', active => {
            setActiveGroupCall(prev => (prev && prev.sessionId === groupCallCoordinator.sessionId) ? { ...prev, isScreensharing: active } : prev);
        });
        const offCoWatch = groupCallCoordinator.on('co-watch-changed', state => {
            setActiveGroupCall(prev => (prev && prev.sessionId === groupCallCoordinator.sessionId) ? { ...prev, coWatchActive: Boolean(state?.active) } : prev);
        });
        const offStage = groupCallCoordinator.on('stage-changed', stage => {
            setStageState(stage);
            handRaiseQueueRef.current = stage.handRaiseQueue;
            const localId = client.getUserId();
            const previousHands = previousHandRaiseRef.current;
            const nextHands = new Set(stage.handRaiseQueue);
            if (notificationsEnabled && canStartGroupCall) {
                stage.handRaiseQueue.forEach(userId => {
                    if (userId === localId || previousHands.has(userId)) {
                        return;
                    }
                    const participant = groupCallCoordinator.getParticipants().find(p => p.userId === userId);
                    const displayName = participant?.displayName ?? userId;
                    const roomId = activeGroupCall?.roomId ?? selectedRoomId ?? undefined;
                    if (roomId) {
                        sendNotification('Запрос на выступление', `${displayName} поднял руку`, { roomId });
                    }
                    const targetRoomId = activeGroupCall?.roomId ?? selectedRoomId ?? null;
                    if (targetRoomId) {
                        notifyStageRequest({
                            roomId: targetRoomId,
                            sessionId: activeGroupCall?.sessionId ?? groupCallCoordinator.sessionId,
                            userId,
                            displayName,
                            inviterId: localId ?? undefined,
                            reason: 'hand_raise',
                        });
                    }
                });
            }
            previousHandRaiseRef.current = nextHands;
        });
        setStageState(groupCallCoordinator.getStageState());
        handRaiseQueueRef.current = groupCallCoordinator.getHandRaiseQueue();
        previousHandRaiseRef.current = new Set(groupCallCoordinator.getHandRaiseQueue());
        return () => {
            offParticipants?.();
            offScreenshare?.();
            offCoWatch?.();
            offStage?.();
        };
    }, [
        groupCallCoordinator,
        client,
        notificationsEnabled,
        activeGroupCall?.roomId,
        activeGroupCall?.sessionId,
        canStartGroupCall,
        selectedRoomId,
    ]);

    useEffect(() => {
        if (!groupCallCoordinator || !activeGroupCall || !canStartGroupCall) return;
        let disposed = false;
        const interval = window.setInterval(() => {
            if (disposed) return;
            const now = Date.now();
            const snapshot = groupCallCoordinator.getParticipants();
            snapshot.forEach(participant => {
                if (participant.userId === client.getUserId()) return;
                if (
                    shouldAutoDemoteParticipant(
                        {
                            role: participant.role,
                            isMuted: participant.isMuted,
                            isVideoMuted: participant.isVideoMuted,
                            lastActive: participant.lastActive,
                        },
                        now,
                    )
                ) {
                    groupCallCoordinator.moveParticipantToAudience(participant.userId);
                    notifyStageAutoDemote({
                        roomId: activeGroupCall.roomId,
                        sessionId: activeGroupCall.sessionId,
                        userId: participant.userId,
                        displayName: participant.displayName ?? participant.userId,
                        inviterId: client.getUserId() ?? undefined,
                        reason: 'auto_demote',
                    });
                    if (notificationsEnabled) {
                        sendNotification('Участник переведён в зрители', participant.displayName ?? participant.userId, {
                            roomId: activeGroupCall.roomId,
                        });
                    }
                }
            });
        }, 45_000);
        return () => {
            disposed = true;
            window.clearInterval(interval);
        };
    }, [groupCallCoordinator, activeGroupCall, client, canStartGroupCall, notificationsEnabled]);

    useEffect(() => {
        if (!activeGroupCall) return;
        previousParticipantIdsRef.current = new Set(groupParticipants.map(p => p.userId));
    }, [activeGroupCall, groupParticipants]);

    useEffect(() => {
        return () => {
            if (activeGroupCall) {
                void leaveGroupCallCoordinator(activeGroupCall.roomId, activeGroupCall.sessionId);
            }
        };
    }, [activeGroupCall]);


    const participantViews = useMemo(() => {
        const roomForPresence = activeGroupCall
            ? client.getRoom(activeGroupCall.roomId)
            : selectedRoomId
                ? client.getRoom(selectedRoomId)
                : null;
        const presenceAllowed = !isPresenceHidden && canSharePresenceInRoom(roomForPresence, currentUserId);
        return groupParticipants.map(participant => {
            const summary = presenceAllowed
                ? describePresence(participant.userId, presenceState.get(participant.userId), client)
                : undefined;
            return {
                id: participant.userId,
                name: participant.displayName ?? participant.userId,
                isMuted: participant.isMuted,
                isVideoMuted: participant.isVideoMuted,
                isScreenSharing: participant.isScreensharing,
                isCoWatching: participant.isCoWatching,
                avatarUrl: participant.avatarUrl ?? null,
                role: participant.role ?? 'participant',
                isLocal: participant.userId === (client.getUserId() || ''),
                lastActive: participant.lastActive,
                handRaisedAt: participant.handRaisedAt ?? undefined,
                stream: participant.stream ?? null,
                screenshareStream: participant.screenshareStream ?? null,
                dominant: Boolean(spotlightParticipantId && participant.userId === spotlightParticipantId),
                presenceSummary: summary
                    ? { ...summary, formattedUserId: formatMatrixIdForDisplay(participant.userId) }
                    : undefined,
            };
        });
    }, [groupParticipants, client, spotlightParticipantId, activeGroupCall, selectedRoomId, presenceState, isPresenceHidden, currentUserId]);

    const handleSetChatBackground = (bgUrl: string) => {
        setChatBackground(bgUrl);
        localStorage.setItem('matrix-chat-bg', bgUrl);
    };

    const handleResetChatBackground = () => {
        setChatBackground('');
        localStorage.removeItem('matrix-chat-bg');
    };

    const handleAnimatedReactionsToggle = useCallback((enabled: boolean) => {
        persistAnimatedReactionsEnabled(enabled);
    }, []);

    const handleSendKeyBehaviorChange = useCallback((behavior: SendKeyBehavior) => {
        setSendKeyBehavior(behavior);
    }, []);

    const handleCancelPending = useCallback(async (id: string) => {
        try {
            await cancelOutboxItem(id);
        } catch (error) {
            console.error('Failed to cancel queued event', error);
        }
    }, []);

    const handleRetryPending = useCallback(async (id: string) => {
        try {
            await retryOutboxItem(id);
        } catch (error) {
            console.error('Failed to retry queued event', error);
        }
    }, []);
    const handleAcceptVerification = async (req: any) => {
        try {
            await req.accept?.();
            const sas = await req.startVerification?.('m.sas.v1');
            // UI for SAS is not implemented. Auto-confirm if API allows in this environment.
            await sas?.confirm?.();
            setVerificationRequests(prev => prev.filter(r => r !== req));
        } catch (e) {
            console.error('Verification accept failed', e);
        }
    };
    const handleDeclineVerification = async (req: any) => {
        try {
            await req.cancel?.();
        } catch (e) {
            // ignore
        } finally {
            setVerificationRequests(prev => prev.filter(r => r !== req));
        }
    };
    const handleEnableKeyBackup = async () => {
        try {
            await (client.getCrypto() as any)?.bootstrapSecretStorage?.({
                createSecretStorageKey: true,
                setupNewKeyBackup: true,
            });
            setIsKeyBackupEnabled(true);
        } catch (e) {
            console.error('Failed to enable key backup', e);
        }
    };


    const handleDismissSecureAlert = useCallback((roomId: string, eventId?: string) => {
        setSecureCloudAlerts(prev => {
            const existing = prev[roomId] ?? [];
            const nextAlerts = eventId ? existing.filter(alert => alert.eventId !== eventId) : [];
            const next: Record<string, SuspiciousEventNotice[]> = { ...prev };
            if (nextAlerts.length === 0) {
                delete next[roomId];
            } else {
                next[roomId] = nextAlerts;
            }
            return next;
        });
        acknowledgeSuspiciousEvents(client, roomId, eventId ? [eventId] : undefined);
    }, [client]);

    // Scheduler check loop
    useEffect(() => {
        let isDisposed = false;
        let isProcessing = false;

        const resolveScheduledTime = (message: ScheduledMessage): number => {
            const baseUtc =
                message.sendAtUtc ??
                (typeof message.timezoneOffset === 'number'
                    ? message.sendAt + message.timezoneOffset * 60_000
                    : message.sendAt);

            if (typeof message.nextRetryAt === 'number') {
                return message.nextRetryAt;
            }

            return baseUtc;
        };

        const tick = async () => {
            if (isProcessing) return;
            isProcessing = true;

            try {
                const messages = await getScheduledMessages(client);
                const nowUtc = Date.now();

                for (const message of messages) {
                    if (isDisposed) {
                        break;
                    }

                    if (message.status === 'sent') {
                        continue;
                    }

                    const dueAt = resolveScheduledTime(message);
                    if (dueAt > nowUtc) {
                        continue;
                    }

                    try {
                        console.log(`Sending scheduled message ${message.id} to room ${message.roomId}`);
                        await dispatchScheduledMessage(message);
                        await markScheduledMessageSent(client, message.id);
                    } catch (error) {
                        console.error(`Failed to send scheduled message ${message.id}:`, error);
                        await recordScheduledMessageError(client, message.id, error);
                    }
                }
            } finally {
                isProcessing = false;
            }
        };

        void tick();
        const interval = window.setInterval(() => {
            void tick();
        }, 5000);

        return () => {
            isDisposed = true;
            window.clearInterval(interval);
        };
    }, [client, dispatchScheduledMessage]);

    useEffect(() => {
        let disposed = false;
        const syncInitial = async () => {
            try {
                const existing = await getOutboxPending();
                if (disposed) return;
                const mapped = existing.reduce<Record<string, { payload: OutboxPayload; attempts: number; error?: string; progress?: OutboxProgressState }>>((acc, item) => {
                    acc[item.id] = {
                        payload: item,
                        attempts: item.attempts ?? 0,
                        progress: deriveOutboxProgress(item),
                    };
                    return acc;
                }, {});
                setOutboxItems(mapped);
            } catch (error) {
                console.error('Failed to load pending outbox items', error);
            }
        };
        void syncInitial();

        const unsubscribe = onOutboxEvent(event => {
            if (event.kind === 'status') {
                setIsOffline(!event.online);
                return;
            }

            setOutboxItems(prev => {
                const next = { ...prev };
                switch (event.kind) {
                    case 'enqueued':
                        next[event.item.id] = {
                            payload: event.item,
                            attempts: event.item.attempts ?? 0,
                            progress: deriveOutboxProgress(event.item),
                        };
                        break;
                    case 'progress': {
                        const payload = event.item ?? next[event.id]?.payload;
                        if (payload) {
                            next[event.id] = {
                                payload,
                                attempts: event.attempts,
                                error: undefined,
                                progress: event.progress ?? deriveOutboxProgress(payload),
                            };
                        } else if (next[event.id]) {
                            next[event.id] = {
                                ...next[event.id],
                                attempts: event.attempts,
                                error: undefined,
                                progress: event.progress ?? deriveOutboxProgress(next[event.id].payload),
                            };
                        }
                        break;
                    }
                    case 'sent':
                    case 'cancelled':
                        delete next[event.id];
                        break;
                    case 'error':
                        if (next[event.id]) {
                            next[event.id] = {
                                ...next[event.id],
                                error: formatOutboxError(event.error),
                                progress: deriveOutboxProgress(next[event.id].payload),
                            };
                        }
                        break;
                    default:
                        return prev;
                }
                return next;
            });
        });

        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, [formatOutboxError, deriveOutboxProgress]);

    const pendingQueueForRoom = useMemo<PendingQueueSummary[]>(() => {
        if (!selectedRoomId) {
            return [];
        }
        return Object.values(outboxItems)
            .filter(entry => entry.payload.roomId === selectedRoomId)
            .map(entry => ({
                ...entry.payload,
                attempts: entry.attempts,
                error: entry.error,
                progress: entry.progress ?? deriveOutboxProgress(entry.payload),
            }));
    }, [outboxItems, selectedRoomId, deriveOutboxProgress]);

    const buildPendingMessage = useCallback((entry: PendingQueueSummary): Message | null => {
        if (entry.type !== EventType.RoomMessage) {
            return null;
        }

        const userId = client.getUserId();
        if (!userId) {
            return null;
        }

        const user = client.getUser(userId);
        const baseContent = entry.content ? { ...entry.content } : {};
        if (typeof baseContent.body !== 'string' || baseContent.body.trim().length === 0) {
            const attachmentName = entry.attachments?.find(att => att?.name)?.name;
            if (attachmentName) {
                baseContent.body = attachmentName;
            }
        }

        const pending: Message = {
            id: entry.id,
            sender: {
                id: userId,
                name: user?.displayName || 'Я',
                avatarUrl: mxcToHttp(client, user?.avatarUrl),
            },
            content: baseContent,
            timestamp: entry.ts ?? Date.now(),
            isOwn: true,
            reactions: null,
            isEdited: false,
            isRedacted: false,
            replyTo: null,
            readBy: {},
            threadReplyCount: 0,
        } as Message;

        (pending as any).isUploading = true;
        (pending as any).isPending = true;
        (pending as any).outboxAttempts = entry.attempts;
        if (entry.error) {
            (pending as any).outboxError = entry.error;
        }

        const firstAttachment = entry.attachments?.[0] as any;
        if (typeof firstAttachment?.dataUrl === 'string') {
            (pending as any).localUrl = firstAttachment.dataUrl;
        } else if (typeof firstAttachment?.remoteUrl === 'string') {
            (pending as any).localUrl = firstAttachment.remoteUrl;
        } else if (firstAttachment?.mode === 'remote' && typeof firstAttachment.remoteUrl === 'string') {
            (pending as any).localUrl = firstAttachment.remoteUrl;
        }

        return pending;
    }, [client]);

    const pendingMessages = useMemo(() => (
        pendingQueueForRoom
            .map(buildPendingMessage)
            .filter((msg): msg is Message => Boolean(msg))
    ), [pendingQueueForRoom, buildPendingMessage]);


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
        return parseMatrixEventUtil(client, event);
    }, [client]);

    const loadRoomMessages = useCallback((roomId: string, focusEventId?: string | null) => {
        const room = client.getRoom(roomId);
        if (!room) return;

        if (focusEventId !== undefined) {
            focusEventIdRef.current = focusEventId;
        }

        const effectiveFocusId = focusEventIdRef.current;
        let timelineEvents = room.getLiveTimeline().getEvents();

        if (effectiveFocusId) {
            const focusTimeline = room.getTimelineForEvent(effectiveFocusId);
            if (focusTimeline) {
                timelineEvents = focusTimeline.getEvents();
            }
        }

        const mainTimelineEvents = timelineEvents
            .filter(event => !event.getRelation() || event.getRelation().rel_type !== 'm.thread');

        setMessages(mainTimelineEvents.map(parseMatrixEvent));
        // FIX: Convert RoomMember[] to User[] to match the state type.
        setRoomMembers(room.getJoinedMembers().map(m => m.user).filter((u): u is MatrixUser => !!u));
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

    const loadRooms = useCallback(() => {
        const matrixRooms = client.getRooms();
        const sortedRooms = matrixRooms
            .filter(room => room.getJoinedMemberCount() > 0) // Show all rooms including self-chats
            .sort((a, b) => {
                const lastEventA = a.timeline[a.timeline.length - 1];
                const lastEventB = b.timeline[b.timeline.length - 1];
                return (lastEventB?.getTs() || 0) - (lastEventA?.getTs() || 0);
            });

        let savedMessagesRoom: UIRoom | null = null;

        const nextHiddenRoomIds: string[] = [];

        const scheduledCountByRoom = allScheduledMessages.reduce<Record<string, number>>((acc, message) => {
            if (!message || typeof message.roomId !== 'string') {
                return acc;
            }
            if (message.status === 'sent') {
                return acc;
            }
            acc[message.roomId] = (acc[message.roomId] ?? 0) + 1;
            return acc;
        }, {});

        const secureAlertCounts = Object.entries(secureCloudAlerts).reduce<Record<string, number>>(
            (acc, [roomId, alerts]) => {
                if (!Array.isArray(alerts) || alerts.length === 0) {
                    return acc;
                }
                acc[roomId] = alerts.length;
                return acc;
            },
            {},
        );

        const roomData: UIRoom[] = sortedRooms.map(room => {
            const lastEvent = room.timeline[room.timeline.length - 1];
            const pinnedEvent = room.currentState.getStateEvents(EventType.RoomPinnedEvents, '');
            const topicEvent = room.currentState.getStateEvents(EventType.RoomTopic, '');
            const topicContent = topicEvent?.getContent?.();
            const topic = typeof topicContent?.topic === 'string' ? topicContent.topic : undefined;
            const canonicalAliasEvent = room.currentState.getStateEvents(EventType.RoomCanonicalAlias, '');
            const canonicalAliasContent = canonicalAliasEvent?.getContent?.();
            const canonicalAlias = typeof canonicalAliasContent?.alias === 'string'
                ? canonicalAliasContent.alias
                : (Array.isArray(canonicalAliasContent?.alt_aliases) && canonicalAliasContent.alt_aliases.length > 0
                    ? canonicalAliasContent.alt_aliases[0]
                    : undefined);
            const roomType = room.getType() || null;
            const isSpace = roomType === 'm.space';
            const childEvents = room.currentState.getStateEvents(EventType.SpaceChild) as MatrixEvent[] | undefined;
            const spaceChildIds = (Array.isArray(childEvents) ? childEvents : [])
                .map(ev => ev.getStateKey())
                .filter((id): id is string => !!id);
            const parentEvents = room.currentState.getStateEvents(EventType.SpaceParent) as MatrixEvent[] | undefined;
            const spaceParentIds = (Array.isArray(parentEvents) ? parentEvents : [])
                .map(ev => ev.getStateKey())
                .filter((id): id is string => !!id);
            const ttlAccountData = room.getAccountData('m.room.ttl' as any);
            const ttlValue = typeof ttlAccountData?.getContent?.()?.ttl === 'number' ? ttlAccountData.getContent().ttl as number : null;
            const ttlSeconds = ttlValue ? Math.round(ttlValue / 1000) : null;
            const hidden = isRoomHidden(client, room.roomId);
            if (hidden) {
                nextHiddenRoomIds.push(room.roomId);
            }
            const mentionCount = room.getUnreadNotificationCount(NotificationCountType.Highlight);
            const scheduledCount = scheduledCountByRoom[room.roomId] ?? 0;
            const secureAlerts = secureAlertCounts[room.roomId] ?? 0;
            const isServiceRoom = roomType === 'm.server_notice';

            const uiRoom: UIRoom = {
                roomId: room.roomId,
                name: room.name,
                topic,
                avatarUrl: mxcToHttp(client, room.getMxcAvatarUrl()),
                lastMessage: lastEvent ? parseMatrixEvent(lastEvent) : null,
                unreadCount: room.getUnreadNotificationCount(NotificationCountType.Total),
                pinnedEvents: pinnedEvent?.getContent().pinned || [],
                isEncrypted: client.isRoomEncrypted(room.roomId),
                isDirectMessageRoom: room.getJoinedMemberCount() === 2,
                roomType,
                isSpace,
                spaceChildIds,
                spaceParentIds,
                canonicalAlias: canonicalAlias ?? null,
                isHidden: hidden,
                selfDestructSeconds: ttlSeconds,
                mentionCount,
                scheduledMessageCount: scheduledCount,
                secureAlertCount: secureAlerts,
                isServiceRoom,
            };

            if (room.roomId === savedMessagesRoomId) {
                savedMessagesRoom = {
                    ...uiRoom,
                    name: 'Saved Messages',
                    isSavedMessages: true,
                };
            }

            if (hidden && appLockState.enabled && !appLockState.unlocked) {
                return {
                    ...uiRoom,
                    name: '🔒 Hidden chat',
                    lastMessage: null,
                    unreadCount: 0,
                    mentionCount: 0,
                    scheduledMessageCount: 0,
                    secureAlertCount: 0,
                };
            }

            return uiRoom;

        }).filter(r => r.roomId !== savedMessagesRoomId);

        if (savedMessagesRoom) {
            setRooms([savedMessagesRoom, ...roomData]);
        } else {
            setRooms(roomData);
        }

        setIsRoomsLoading(false);
        setHiddenRoomIds(nextHiddenRoomIds);
    }, [
        client,
        savedMessagesRoomId,
        parseMatrixEvent,
        appLockState.enabled,
        appLockState.unlocked,
        allScheduledMessages,
        secureCloudAlerts,
    ]);

    useEffect(() => {
        loadRooms();

        const onSync = (state: string, _prev?: string | null, data?: { presence?: { events?: Array<{ content?: PresenceEventContent; sender?: string }> } }) => {
            if (state === 'ERROR' || state === 'STOPPED') {
                setIsOffline(true);
            } else if (state === 'SYNCING' || state === 'PREPARED') {
                setIsOffline(false);
            }

            if (state === 'PREPARED') {
                loadRooms();
                if (selectedRoomId) {
                    loadRoomMessages(selectedRoomId);
                    loadPinnedMessage(selectedRoomId);
                }
            }

            const presenceEvents = data?.presence?.events ?? [];
            if (presenceEvents.length > 0) {
                const updates = presenceEvents
                    .map(event => {
                        const userId = event?.sender ?? event?.content?.user_id;
                        if (!userId || (isPresenceHidden && userId === currentUserId)) return null;
                        const content = event?.content;
                        if (!content) return null;
                        return { userId, content: normalisePresenceContent(content) };
                    })
                    .filter((entry): entry is { userId: string; content: PresenceEventContent } => Boolean(entry));
                if (updates.length > 0) {
                    dispatchPresence({ type: 'bulk', updates });
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
            if (!roomId) return;

            if (notificationsEnabled && !document.hasFocus() && event.getSender() !== client.getUserId() && (event.getType() === EventType.RoomMessage || event.getType() === 'm.sticker') && !event.isRedacted()) {
                const room = client.getRoom(roomId);
                const senderName = event.sender?.name || 'Unknown User';
                const content = event.getContent();
                const messageBody = content.body;
                const currentUserId = client.getUserId?.();
                const mentionList = Array.isArray(content?.['m.mentions']?.user_ids)
                    ? content['m.mentions'].user_ids as string[]
                    : [];
                const isMention = currentUserId ? mentionList.includes(currentUserId) : false;
                if (room && room.roomId !== savedMessagesRoomId) {
                    sendNotification(room.name, `${senderName}: ${messageBody}`, { roomId, isMention });
                }
            }

            loadRooms();

            if (roomId === selectedRoomId) {
                if ((event.getType() === EventType.RoomMessage || event.getType() === 'm.sticker') && event.getSender() === client.getUserId()) {
                    const txnId = event.getTxnId();
                    if (txnId) {
                        setMessages(prev => prev.filter(m => m.id !== txnId));
                    }
                }

                if (activeThread) {
                    const relation = event.getRelation();
                    if (relation?.rel_type === 'm.thread' && relation.event_id === activeThread.rootMessage.id) {
                        const room = client.getRoom(roomId);
                        const threadEvents = room?.getThread(activeThread.rootMessage.id)?.events;
                        setActiveThread(prev => (prev ? ({
                            ...prev,
                            threadMessages: threadEvents?.map(parseMatrixEvent) || []
                        }) : null));
                    }
                }

                loadRoomMessages(roomId);
            }
        };

        const onTyping = (event: MatrixEvent, room: MatrixRoom) => {
            if (!selectedRoomId || room.roomId !== selectedRoomId) return;
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

        client.on(ClientEvent.Sync, onSync as any);
        client.on(RoomEvent.Timeline, onRoomEvent);
        client.on("Room.state" as any, onRoomStateEvent);
        client.on('Room.typing' as any, onTyping);
        client.on(RoomEvent.Receipt, onReceipt);
        client.on(UserEvent.DisplayName, onUserProfileChange);
        client.on(UserEvent.AvatarUrl, onUserProfileChange);

        return () => {
            client.removeListener(ClientEvent.Sync, onSync as any);
            client.removeListener(RoomEvent.Timeline, onRoomEvent);
            client.removeListener("Room.state" as any, onRoomStateEvent);
            client.removeListener('Room.typing' as any, onTyping);
            client.removeListener(RoomEvent.Receipt, onReceipt);
            client.removeListener(UserEvent.DisplayName, onUserProfileChange);
            client.removeListener(UserEvent.AvatarUrl, onUserProfileChange);
        };
    }, [client, selectedRoomId, parseMatrixEvent, loadRoomMessages, activeThread, loadPinnedMessage, notificationsEnabled, savedMessagesRoomId, loadRooms, isPresenceHidden, currentUserId, normalisePresenceContent, dispatchPresence]);

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
            publishCallSession(call, 'ringing');

            if (notificationsEnabled && !document.hasFocus()) {
                const peerMember = (call as any).getPeerMember();
                const peerName = peerMember?.name || 'Unknown User';
                const callType = call.type === 'video' ? 'Video' : 'Voice';
                sendNotification(`Incoming ${callType} Call`, `From: ${peerName}`, { roomId: call.roomId ?? undefined, isMention: true });
            }
        };

        // FIX: The event for an incoming call on the client is 'Call.incoming', which is not in the SDK's event types. Cast to `any` to bypass the type check.
        client.on('Call.incoming' as any, onCallIncoming);
        return () => {
            // FIX: The event for an incoming call on the client is 'Call.incoming', which is not in the SDK's event types. Cast to `any` to bypass the type check.
            client.removeListener('Call.incoming' as any, onCallIncoming);
        };
    }, [client, activeCall, notificationsEnabled, publishCallSession]);

    useEffect(() => {
        if (!activeCall) return;

        const onHangup = () => {
            console.log("Call hung up");
            setActiveCall(null);
            setCallSessionForClient(client, null);
        };

        const onStateChanged = (state: string) => {
            if (state === 'ended') {
                setCallSessionForClient(client, null);
            } else if (state === 'connected') {
                publishCallSession(activeCall, 'connected');
            } else if (state === 'connecting' || state === 'create_offer') {
                publishCallSession(activeCall, 'connecting');
            }
        };

        onStateChanged((activeCall as any).state ?? '');
        activeCall.on(CallEvent.Hangup, onHangup);
        activeCall.on(CallEvent.State, onStateChanged as any);
        return () => {
            activeCall.removeListener(CallEvent.Hangup, onHangup);
            activeCall.removeListener(CallEvent.State, onStateChanged as any);
        };
    }, [activeCall, client, publishCallSession]);

    const handleSelectRoom = useCallback(async (roomId: string) => {
        const targetRoom = client.getRoom(roomId);
        const hidden = targetRoom ? isRoomHidden(client, roomId) : false;
        if (hidden && appLockState.enabled && !appLockState.unlocked) {
            setPendingHiddenRoomId(roomId);
            setPinInput('');
            setPinError(null);
            setIsPinPromptOpen(true);
            return;
        }

        if (selectedRoomId) {
             await sendTypingIndicator(client, selectedRoomId, false);
        }

        setSelectedRoomId(roomId);
        setReplyingTo(null);
        setTypingUsers([]);
        setCanPaginate(true);
        setActiveThread(null); // Close thread view when switching rooms
        setTranslatedMessages({}); // Clear translations when switching rooms
        setHighlightedMessage(null);
        setPendingScrollTarget(null);
        focusEventIdRef.current = null;
        const room = targetRoom;
        if (room) {
            setCanPin(room.currentState.maySendStateEvent(EventType.RoomPinnedEvents, client.getUserId()!));
            loadPinnedMessage(roomId);

            const timeline = room.getLiveTimeline().getEvents();
            const lastEvent = timeline[timeline.length - 1];
            if (lastEvent) {
                await sendReadReceipt(client, roomId, lastEvent.getId()!);
            }

            loadRoomMessages(roomId, null);
            // FIX: The `getTypingMembers` method does not exist in this SDK version. Use `getMembersWithTyping` instead.
            // FIX: The `getMembersWithTyping` method exists at runtime but is not in the SDK's Room type definition. Cast to `any` to use it.
            setTypingUsers((room as any).getMembersWithTyping().map((m: any) => m.name));

            const ttlAccountData = room.getAccountData('m.room.ttl' as any);
            const ttlValue = typeof ttlAccountData?.getContent?.()?.ttl === 'number' ? ttlAccountData.getContent().ttl as number : null;
            setCurrentSelfDestructSeconds(ttlValue ? Math.round(ttlValue / 1000) : null);

            setTimeout(() => scrollToBottom('auto'), 100);
        } else {
            setCurrentSelfDestructSeconds(null);
        }
    }, [client, selectedRoomId, scrollToBottom, loadRoomMessages, loadPinnedMessage, appLockState.enabled, appLockState.unlocked]);

    const handleSelfDestructChange = useCallback(async (seconds: number | null) => {
        if (!selectedRoomId) return;
        try {
            await setRoomTTL(client, selectedRoomId, seconds ? seconds * 1000 : null);
            setCurrentSelfDestructSeconds(seconds);
            await notifyTimerChange(seconds);
            loadRooms();
        } catch (error) {
            console.error('Failed to update self-destruct timer', error);
        }
    }, [client, selectedRoomId, notifyTimerChange, loadRooms]);

    const handleToggleHiddenRoom = useCallback(async () => {
        if (!selectedRoomId) return;
        const room = client.getRoom(selectedRoomId);
        const hidden = room ? isRoomHidden(client, selectedRoomId) : false;
        if (!hidden && !appLockState.enabled) {
            window.alert('Сначала включите блокировку приложения и задайте PIN в настройках безопасности.');
            return;
        }
        if (!hidden && appLockState.enabled && !appLockState.unlocked) {
            setPendingHiddenRoomId(selectedRoomId);
            setPinInput('');
            setPinError(null);
            setIsPinPromptOpen(true);
            return;
        }
        try {
            await setRoomHidden(client, selectedRoomId, !hidden);
            loadRooms();
        } catch (error) {
            console.error('Failed to toggle hidden state', error);
        }
    }, [client, selectedRoomId, appLockState.enabled, appLockState.unlocked, loadRooms]);

    const handleUnlockByPin = useCallback(async () => {
        const result = await unlockWithPin(pinInput);
        if (!result.success) {
            setPinError(result.error ?? 'Не удалось проверить PIN');
            return;
        }
        setAppLockState(prev => ({ ...prev, unlocked: true }));
        setIsPinPromptOpen(false);
        const target = pendingHiddenRoomId;
        setPendingHiddenRoomId(null);
        if (target) {
            await handleSelectRoom(target);
        }
    }, [pinInput, handleSelectRoom, pendingHiddenRoomId]);

    const handleUnlockByBiometric = useCallback(async () => {
        const result = await unlockWithBiometric();
        if (!result.success) {
            setPinError(result.error ?? 'Биометрическая проверка не удалась');
            return;
        }
        setAppLockState(prev => ({ ...prev, unlocked: true }));
        setIsPinPromptOpen(false);
        const target = pendingHiddenRoomId;
        setPendingHiddenRoomId(null);
        if (target) {
            await handleSelectRoom(target);
        }
    }, [handleSelectRoom, pendingHiddenRoomId]);

    const handleJumpToSearchResult = useCallback(async (result: SearchResultItem) => {
        const eventId = result.event.getId();
        if (!eventId) {
            return;
        }

        setIsSearchOpen(false);

        try {
            await handleSelectRoom(result.roomId);
        } catch (error) {
            console.error('Failed to switch room for search result:', error);
            return;
        }

        const room = client.getRoom(result.roomId);
        if (!room) {
            return;
        }

        const timelineSet = room.getLiveTimeline().getTimelineSet();
        try {
            await client.getEventTimeline(timelineSet, eventId);
        } catch (error) {
            console.warn('Failed to load timeline for search result:', error);
        }

        loadRoomMessages(result.roomId, eventId);

        if (!room.findEventById(eventId)) {
            const contextEvents = [...result.context.before, result.event, ...result.context.after];
            if (contextEvents.length > 0) {
                setMessages(contextEvents.map(parseMatrixEvent));
            }
        }

        setHighlightedMessage({ roomId: result.roomId, eventId });
        setPendingScrollTarget({ roomId: result.roomId, eventId });
    }, [client, handleSelectRoom, loadRoomMessages, parseMatrixEvent]);
    
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

    useEffect(() => {
        if (!selectedRoomId) return;

        setDrafts(prev => {
            if (prev[selectedRoomId] !== undefined) {
                return prev;
            }
            return { ...prev, [selectedRoomId]: { plain: '', formatted: undefined, attachments: [], msgtype: undefined } };
        });

        let isActive = true;

        const loadAccountDrafts = async () => {
            try {
                const accountData = client.getAccountData(DRAFT_ACCOUNT_DATA_EVENT as any);
                const content = accountData?.getContent() as Record<string, unknown> | undefined;
                if (!isActive || !content || typeof content !== 'object') {
                    return;
                }

                setDrafts(prev => {
                    let hasChanges = false;
                    const nextDrafts = { ...prev };
                    Object.entries(content).forEach(([roomId, value]) => {
                        const normalized = normalizeDraft(value);
                        const existing = nextDrafts[roomId];
                        if (!existing
                            || existing.plain !== normalized.plain
                            || existing.formatted !== normalized.formatted
                            || !areAttachmentsEqual(existing.attachments, normalized.attachments)
                        ) {
                            nextDrafts[roomId] = normalized;
                            hasChanges = true;
                        }
                    });

                    return hasChanges ? nextDrafts : prev;
                });
            } catch (error) {
                console.error('Failed to load drafts from Matrix account data', error);
            }
        };

        loadAccountDrafts();

        return () => {
            isActive = false;
        };
    }, [client, selectedRoomId]);

    useEffect(() => {
        setIsSharedMediaOpen(false);
        setSharedMediaData(null);
        sharedMediaEventIdsRef.current = new Set();

        if (!selectedRoomId) {
            setIsSharedMediaLoading(false);
            return;
        }

        const room = client.getRoom(selectedRoomId);
        if (!room) {
            setIsSharedMediaLoading(false);
            return;
        }

        setIsSharedMediaLoading(true);
        try {
            const summary = getRoomMediaSummary(client, room);
            setSharedMediaData(summary);
            sharedMediaEventIdsRef.current = new Set(summary.eventIds);
        } catch (error) {
            console.error('Failed to load shared media summary', error);
        } finally {
            setIsSharedMediaLoading(false);
        }
    }, [client, selectedRoomId]);

    const handleDraftChange = useCallback((roomId: string, value: DraftContent) => {
        setDrafts(prev => {
            const currentValue = prev[roomId];
            if (currentValue
                && currentValue.plain === value.plain
                && currentValue.formatted === value.formatted
                && areAttachmentsEqual(currentValue.attachments, value.attachments)
            ) {
                return prev;
            }
            return { ...prev, [roomId]: value };
        });
    }, []);

    const handleActiveDraftChange = useCallback((value: DraftContent) => {
        if (!selectedRoomId) return;
        handleDraftChange(selectedRoomId, value);
    }, [handleDraftChange, selectedRoomId]);

    const handleOpenSharedMedia = useCallback(() => {
        if (!selectedRoomId) {
            return;
        }
        setIsSharedMediaOpen(true);
    }, [selectedRoomId]);

    const handleLoadMoreMedia = useCallback(async () => {
        if (!selectedRoomId || isSharedMediaPaginating) {
            return;
        }
        const room = client.getRoom(selectedRoomId);
        if (!room) {
            return;
        }

        setIsSharedMediaPaginating(true);
        try {
            const page = await paginateRoomMedia(client, room, {
                knownEventIds: sharedMediaEventIdsRef.current,
                limit: 40,
            });

            setSharedMediaData(prev => {
                if (!prev) {
                    if (page.newEventIds.length === 0 && !page.hasMore) {
                        return prev;
                    }
                    sharedMediaEventIdsRef.current = new Set(page.newEventIds);
                    return {
                        itemsByCategory: page.itemsByCategory,
                        countsByCategory: page.countsByCategory,
                        hasMore: page.hasMore,
                        eventIds: page.newEventIds,
                    };
                }

                if (page.newEventIds.length === 0) {
                    return { ...prev, hasMore: page.hasMore };
                }

                const mergedBuckets: Record<SharedMediaCategory, RoomMediaItem[]> = {
                    media: [...prev.itemsByCategory.media],
                    files: [...prev.itemsByCategory.files],
                    links: [...prev.itemsByCategory.links],
                    voice: [...prev.itemsByCategory.voice],
                };

                (Object.keys(page.itemsByCategory) as SharedMediaCategory[]).forEach(category => {
                    if (page.itemsByCategory[category].length) {
                        mergedBuckets[category] = [...mergedBuckets[category], ...page.itemsByCategory[category]]
                            .sort((a, b) => b.timestamp - a.timestamp);
                    }
                });

                const mergedCounts = {
                    media: prev.countsByCategory.media + page.countsByCategory.media,
                    files: prev.countsByCategory.files + page.countsByCategory.files,
                    links: prev.countsByCategory.links + page.countsByCategory.links,
                    voice: prev.countsByCategory.voice + page.countsByCategory.voice,
                };

                const mergedEventIds = [...prev.eventIds, ...page.newEventIds];
                sharedMediaEventIdsRef.current = new Set(mergedEventIds);

                return {
                    itemsByCategory: mergedBuckets,
                    countsByCategory: mergedCounts,
                    hasMore: page.hasMore,
                    eventIds: mergedEventIds,
                };
            });
        } catch (error) {
            console.error('Failed to paginate shared media', error);
        } finally {
            setIsSharedMediaPaginating(false);
        }
    }, [client, isSharedMediaPaginating, selectedRoomId]);

    const handleSendMessage = async (content: { body: string; formattedBody?: string }, threadRootId?: string) => {
        const trimmedBody = content.body.trim();
        if (!trimmedBody || !selectedRoomId) {
            return;
        }

        const roomId = selectedRoomId;
        setIsSending(true);
        try {
            const room = client.getRoom(roomId);
            const eventToReplyTo = replyingTo ? room?.findEventById(replyingTo.id) : undefined;
            await sendMessage(client, roomId, { body: trimmedBody, formattedBody: content.formattedBody }, eventToReplyTo, threadRootId, roomMembers);
            setReplyingTo(null);
            setDrafts(prev => {
                const existing = prev[roomId];
                if (existing && existing.plain === '' && existing.attachments.length === 0) {
                    return prev;
                }
                return { ...prev, [roomId]: { plain: '', formatted: undefined, attachments: [], msgtype: undefined } };
            });
        } catch (error) {
            console.error('Failed to send message:', error);
        } finally {
            setIsSending(false);
        }
    };
    
    const handleSendFile = async (file: File) => {
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
        };

        setMessages(prev => [...prev, tempMessage]);
        scrollToBottom();

        try {
            if (isImage) {
                await sendImageMessage(client, selectedRoomId, file);
            } else {
                await sendFileMessage(client, selectedRoomId, file);
            }
        } catch (error) {
            console.error('Failed to send file:', error);
            setMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            if (localUrl) {
                URL.revokeObjectURL(localUrl);
            }
        }
    };
    
    const handleSendAudio = async (file: Blob, duration: number) => {
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
        };

        setMessages(prev => [...prev, tempMessage]);
        scrollToBottom();

        try {
            await sendAudioMessage(client, selectedRoomId, file, duration);
        } catch (error) {
            console.error('Failed to send audio message:', error);
            setMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            URL.revokeObjectURL(localUrl);
        }
    };

    const handleSendVideo = async (file: Blob, metadata: VideoMessageMetadata) => {
        if (!selectedRoomId) return;

        const tempId = `temp-video-${Date.now()}`;
        const localUrl = URL.createObjectURL(file);
        const localThumbnailUrl = URL.createObjectURL(metadata.thumbnail);
        const user = client.getUser(client.getUserId()!);

        const tempMessage: Message = {
            id: tempId,
            sender: {
                id: client.getUserId()!,
                name: user?.displayName || 'Me',
                avatarUrl: mxcToHttp(client, user?.avatarUrl),
            },
            content: {
                body: 'Video message',
                msgtype: MsgType.Video,
                info: {
                    mimetype: metadata.mimeType,
                    size: file.size,
                    duration: metadata.durationMs,
                    w: metadata.width,
                    h: metadata.height,
                    thumbnail_url: localThumbnailUrl,
                    thumbnail_info: {
                        mimetype: metadata.thumbnailMimeType,
                        size: metadata.thumbnail.size,
                        w: metadata.thumbnailWidth,
                        h: metadata.thumbnailHeight,
                    },
                },
            },
            timestamp: Date.now(),
            isOwn: true,
            reactions: null, isEdited: false, isRedacted: false, replyTo: null, readBy: {},
            isUploading: true,
            localUrl,
            localThumbnailUrl,
            threadReplyCount: 0,
        };

        setMessages(prev => [...prev, tempMessage]);
        scrollToBottom();

        try {
            await sendVideoMessage(client, selectedRoomId, file, metadata);
        } catch (error) {
            console.error('Failed to send video message:', error);
            setMessages(prev => prev.filter(m => m.id !== tempId));
        } finally {
            URL.revokeObjectURL(localUrl);
            URL.revokeObjectURL(localThumbnailUrl);
        }
    };
    
    const handleSendSticker = async (sticker: Sticker) => {
        if (!selectedRoomId) return;
        if (sticker.isCustomEmoji) {
            const shortcode = sticker.shortcodes?.[0] ?? sticker.body;
            if (shortcode) {
                await handleSendMessage({ body: shortcode });
            }
            return;
        }
        try {
            await sendStickerMessage(client, selectedRoomId, sticker.url, sticker.body, sticker.info ?? {});
        } catch (error) {
            console.error('Failed to send sticker:', error);
        }
    };

    const handleSendGif = async (gif: Gif) => {
        if (!selectedRoomId) return;
        try {
            await sendGifMessage(client, selectedRoomId, gif);
        } catch (error) {
            console.error('Failed to send GIF:', error);
        }
    };

    const handleSendLocation = async (payload: LocationContentPayload) => {
        if (!selectedRoomId) return;
        try {
            await sendLocationMessage(client, selectedRoomId, payload);
        } catch (error) {
            console.error('Failed to send location message:', error);
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

    const handleCreateRoom = async (options: RoomCreationOptions) => {
        try {
            const newRoomId = await createRoom(client, options);
            setIsCreateRoomOpen(false);
            await handleSelectRoom(newRoomId);
            return newRoomId;
        } catch(error) {
            console.error("Failed to create room from component:", error);
            throw error;
        }
    };

    const handleInviteUser = async (userId: string) => {
        if (!selectedRoomId) return;
        await inviteUser(client, selectedRoomId, userId);
        setIsInviteUserOpen(false);
    };

    const handleSetNotificationLevel = useCallback(async (roomId: string, mode: RoomNotificationMode) => {
        if (!roomId) {
            return;
        }
        try {
            await updateRoomPushRule(client, roomId, mode);
            setAccountRoomNotificationMode(roomId, mode, activeRuntime?.creds.key ?? null);
            setRoomNotificationPreference(roomId, mode);
        } catch (error) {
            console.error('Failed to update room notification mode', error);
        }
    }, [client, activeRuntime?.creds.key, setAccountRoomNotificationMode]);

    const handleMuteRoom = useCallback((roomId: string) => {
        void handleSetNotificationLevel(roomId, 'mute');
    }, [handleSetNotificationLevel]);

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

    const handleCreatePoll = async (question: string, options: string[]) => {
        if (!selectedRoomId || !question.trim() || options.length < 2) return;
        try {
            await sendPollStart(client, selectedRoomId, question, options);
            setIsCreatePollOpen(false);
        } catch (error) {
            console.error("Failed to create poll:", error);
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
    
    const handleOpenScheduleModal = (content: DraftContent) => {
        setContentToSchedule(content);
        setIsScheduleModalOpen(true);
    };

    const handleConfirmSchedule = async (selection: { sendAtUtc: number; timezoneOffset: number; timezoneId: string; localTimestamp: number }) => {
        if (selectedRoomId && contentToSchedule) {
            const preparedContent = prepareScheduledContent(contentToSchedule);
            const hasContent = preparedContent.plain.trim().length > 0 || preparedContent.attachments.length > 0 || !!preparedContent.msgtype;
            if (hasContent) {
                try {
                    await addScheduledMessage(client, selectedRoomId, preparedContent, selection.sendAtUtc, {
                        timezoneOffset: selection.timezoneOffset,
                        timezoneId: selection.timezoneId,
                        localTimestamp: selection.localTimestamp,
                    });
                    setAllScheduledMessages(await getScheduledMessages(client));
                } catch (error) {
                    console.error('Failed to schedule message', error);
                }
            }
        }
        setIsScheduleModalOpen(false);
        setContentToSchedule(null);
    };

    const handleDeleteScheduled = async (id: string) => {
        try {
            await deleteScheduledMessage(client, id);
            setAllScheduledMessages(await getScheduledMessages(client));
        } catch (error) {
            console.error(`Failed to delete scheduled message ${id}`, error);
        }
    };

    const handleSendScheduledNow = async (id: string) => {
        const msg = allScheduledMessages.find(m => m.id === id);
        if (!msg) {
            return;
        }

        try {
            await dispatchScheduledMessage(msg);
            await markScheduledMessageSent(client, msg.id);
        } catch (error) {
            console.error(`Failed to send scheduled message ${id} immediately:`, error);
            await recordScheduledMessageError(client, id, error);
        } finally {
            try {
                setAllScheduledMessages(await getScheduledMessages(client));
            } catch (loadError) {
                console.error('Failed to refresh scheduled messages after manual send', loadError);
            }
        }
    };

    const handleUpdateScheduled = useCallback(async (id: string, update: ScheduledMessageUpdatePayload) => {
        try {
            await updateScheduledMessage(client, id, update);
            setAllScheduledMessages(await getScheduledMessages(client));
        } catch (error) {
            console.error(`Failed to update scheduled message ${id}`, error);
            throw error;
        }
    }, [client]);

    const handleBulkReschedule = useCallback(async (ids: string[], schedule: ScheduledMessageScheduleUpdate) => {
        try {
            await bulkUpdateScheduledMessages(client, ids.map(id => ({ id, schedule })));
            setAllScheduledMessages(await getScheduledMessages(client));
        } catch (error) {
            console.error('Failed to bulk update scheduled messages', error);
            throw error;
        }
    }, [client]);

    const handleBulkSendScheduled = useCallback(async (ids: string[]) => {
        try {
            const latestMessages = await getScheduledMessages(client);
            const selected = latestMessages.filter(message => ids.includes(message.id));
            const errors: string[] = [];

            for (const message of selected) {
                try {
                    await dispatchScheduledMessage(message);
                    await markScheduledMessageSent(client, message.id);
                } catch (error) {
                    console.error(`Failed to send scheduled message ${message.id} immediately:`, error);
                    errors.push(message.id);
                    await recordScheduledMessageError(client, message.id, error);
                }
            }

            setAllScheduledMessages(await getScheduledMessages(client));

            if (errors.length > 0) {
                throw new Error(`Не удалось отправить ${errors.length} из ${selected.length} сообщений`);
            }
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error('Не удалось выполнить массовую отправку');
        }
    }, [client, dispatchScheduledMessage]);

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
            publishCallSession(call, 'connecting');
        } catch (error) {
            console.error(`Failed to place ${type} call:`, error);
        }
    };

    const handleAnswerCall = () => {
        if (!incomingCall) return;
        incomingCall.answer();
        setActiveCall(incomingCall);
        setIncomingCall(null);
        publishCallSession(incomingCall, 'connecting');
    };

    const handleHangupCall = (isIncoming: boolean) => {
        if (isIncoming && incomingCall) {
            // FIX: Use string literal for hangup reason as CallErrorCode is not exported.
            // FIX: The `CallErrorCode` type is not exported by the SDK. Cast to `any` to bypass the type check.
            incomingCall.hangup('user_hangup' as any, false);
            setIncomingCall(null);
            setCallSessionForClient(client, null);
        } else if (!isIncoming && activeCall) {
            // FIX: Use string literal for hangup reason as CallErrorCode is not exported.
            // FIX: The `CallErrorCode` type is not exported by the SDK. Cast to `any` to bypass the type check.
            activeCall.hangup('user_hangup' as any, true);
            setActiveCall(null);
            setCallSessionForClient(client, null);
        }
    };

    const handleHandoverCall = useCallback(() => {
        const targetSession = roomCallSession ?? accountCallSession;
        if (!targetSession) {
            return;
        }
        handoverCallToCurrentDevice(client, targetSession).catch(error => {
            console.error('Failed to hand over call to current device', error);
        });
    }, [client, roomCallSession, accountCallSession]);

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
    const scheduledForThisRoom = selectedRoomId
        ? allScheduledMessages.filter(m => m.roomId === selectedRoomId && m.status !== 'sent')
        : [];
    const activeRoomAlerts = selectedRoomId ? (secureCloudAlerts[selectedRoomId] ?? []) : [];
    const sharedMediaCount = sharedMediaData
        ? Object.values(sharedMediaData.countsByCategory).reduce((acc, value) => acc + value, 0)
        : 0;

    const digestForSelectedRoom = selectedRoomId ? (digestState.digestMap[selectedRoomId] ?? null) : null;
    const digestGeneratingKey = selectedRoomId
        ? `${(activeAccountKey ?? DEFAULT_DIGEST_ACCOUNT_KEY)}::${selectedRoomId}`
        : null;
    const isDigestGenerating = digestGeneratingKey ? Boolean(digestState.generatingRooms[digestGeneratingKey]) : false;

    useEffect(() => {
        if (!selectedRoomId || !activeAccountKey) {
            return;
        }
        if (!digestState.isHydrated && !isDigestGenerating) {
            return;
        }
        const unread = selectedRoom?.unreadCount ?? 0;
        if (unread <= 0) {
            return;
        }
        if (digestForSelectedRoom) {
            const recentEnough = Date.now() - digestForSelectedRoom.generatedAt < 2 * 60 * 1000;
            if (digestForSelectedRoom.unreadCount === unread && recentEnough) {
                return;
            }
        }
        void generateRoomDigest({
            accountKey: activeAccountKey,
            client,
            roomId: selectedRoomId,
            unreadCount: unread,
        }).catch(error => {
            console.debug('Failed to generate room digest', error);
        });
    }, [selectedRoomId, activeAccountKey, client, selectedRoom?.unreadCount, digestForSelectedRoom, digestState.isHydrated, isDigestGenerating]);

    const catchUpPrompts = useMemo(() => {
        if (!selectedRoomId) return null;
        if (!digestState.isHydrated && !isDigestGenerating) return null;
        const unread = digestForSelectedRoom?.unreadCount ?? selectedRoom?.unreadCount ?? 0;
        if (!digestForSelectedRoom && !isDigestGenerating) {
            return null;
        }
        const participants = digestForSelectedRoom?.participants ?? [];
        const summaryText = digestForSelectedRoom?.summary
            ?? 'Собираем дайджест по последним сообщениям...';
        return (
            <div className="border-b border-border-primary bg-bg-secondary/60 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex-1">
                        <p className="text-sm font-semibold text-text-primary">Дайджест комнаты</p>
                        <p className="mt-1 text-xs text-text-secondary line-clamp-3">{summaryText}</p>
                        {participants.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {participants.map(participant => (
                                    <span key={participant} className="rounded-full bg-bg-tertiary px-2 py-0.5 text-[10px] text-text-secondary">
                                        {participant}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                        <span className="inline-flex items-center rounded-full bg-chip-selected px-2 py-0.5 text-xs font-semibold text-text-inverted">
                            {unread}
                        </span>
                        <button
                            type="button"
                            className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-text-inverted hover:bg-accent-hover disabled:opacity-60"
                            disabled={isDigestGenerating}
                            onClick={() => {
                                if (!selectedRoomId || !activeAccountKey) return;
                                void generateRoomDigest({
                                    accountKey: activeAccountKey,
                                    client,
                                    roomId: selectedRoomId,
                                    unreadCount: selectedRoom?.unreadCount ?? 0,
                                    force: true,
                                });
                            }}
                        >
                            {isDigestGenerating ? 'Обновляем…' : 'Наверстать'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }, [selectedRoomId, digestState.isHydrated, digestForSelectedRoom, isDigestGenerating, selectedRoom?.unreadCount, activeAccountKey, client]);

    const roomPresenceSummaries = useMemo(() => {
        const summaries = new Map<string, PresenceSummary>();
        rooms.forEach(room => {
            if (room.isHidden && appLockState.enabled && !appLockState.unlocked) {
                summaries.set(room.roomId, buildHiddenPresenceSummary());
                return;
            }
            if (!room.isDirectMessageRoom) return;
            const matrixRoom = client.getRoom(room.roomId);
            if (!matrixRoom) return;
            if (isPresenceHidden) {
                summaries.set(room.roomId, buildHiddenPresenceSummary());
                return;
            }
            if (!canSharePresenceInRoom(matrixRoom, currentUserId)) {
                summaries.set(room.roomId, buildRestrictedPresenceSummary());
                return;
            }
            const joinedMembers = (matrixRoom.getJoinedMembers?.() ?? []) as Array<{ userId: string; name?: string; rawDisplayName?: string; user?: MatrixUser }>;
            const counterpart = joinedMembers.find(member => member.userId !== currentUserId);
            if (!counterpart) return;
            const summary = describePresence(counterpart.userId, presenceState.get(counterpart.userId), client);
            summaries.set(room.roomId, {
                ...summary,
                displayName: counterpart.user?.displayName ?? counterpart.name ?? counterpart.userId,
                formattedUserId: formatMatrixIdForDisplay(counterpart.userId),
            });
        });
        return summaries;
    }, [rooms, appLockState.enabled, appLockState.unlocked, client, isPresenceHidden, currentUserId, presenceState]);

    const selectedRoomPresence = selectedRoomId ? roomPresenceSummaries.get(selectedRoomId) : undefined;

    const hasPresenceRestriction = useMemo(() => {
        return rooms.some(room => {
            const matrixRoom = client.getRoom(room.roomId);
            if (!matrixRoom) return false;
            return !canSharePresenceInRoom(matrixRoom, currentUserId);
        });
    }, [rooms, client, currentUserId]);

    const detectorStates = secureCloudProfile?.detectors ?? [];

    const timelineProps: ChatTimelineSectionProps = {
        secureCloud: {
            isActive: isSecureCloudActive,
            error: secureCloudError,
            detectors: detectorStates,
            formatStatus: formatDetectorStatus,
            onClearError: () => setSecureCloudError(null),
            onToggleDetector: handleToggleDetector,
            onUpdateDetectorConfig: handleUpdateDetectorConfig,
            alerts: activeRoomAlerts,
            roomId: selectedRoomId,
            onDismissAlert: handleDismissSecureAlert,
        },
        verification: {
            requests: verificationRequests,
            onAccept: handleAcceptVerification,
            onDecline: handleDeclineVerification,
        },
        messageView: {
            messages,
            client,
            onReaction: handleReaction,
            onEditMessage: handleEditMessage,
            onDeleteMessage: handleDeleteMessage,
            onSetReplyTo: setReplyingTo,
            onForwardMessage: handleOpenForwardModal,
            onImageClick: setViewingImageUrl,
            onOpenThread: handleOpenThread,
            onPollVote: handlePollVote,
            onTranslateMessage: handleTranslateMessage,
            translatedMessages,
            scrollContainerRef,
            onScroll: handleScroll,
            onPaginate: handlePaginate,
            isPaginating,
            canPaginate,
            pinnedEventIds,
            canPin,
            onPinToggle: handlePinToggle,
            highlightedMessageId: highlightedMessage?.roomId === selectedRoomId ? highlightedMessage.eventId : null,
            pendingMessages,
            pendingQueue: pendingQueueForRoom,
            onRetryPending: handleRetryPending,
            onCancelPending: handleCancelPending,
        },
        showScrollToBottom,
        onScrollToBottom: () => scrollToBottom(),
    };

    const composerProps: ChatComposerSectionProps = {
        composer: {
            onSendMessage: handleSendMessage,
            onSendFile: handleSendFile,
            onSendAudio: handleSendAudio,
            onSendVideo: handleSendVideo,
            onSendSticker: handleSendSticker,
            onSendGif: handleSendGif,
            onSendLocation: handleSendLocation,
            onOpenCreatePoll: () => setIsCreatePollOpen(true),
            onSchedule: handleOpenScheduleModal,
            isSending,
            client,
            roomId: selectedRoomId,
            replyingTo,
            onCancelReply: () => setReplyingTo(null),
            roomMembers,
            draftContent: selectedRoomId ? drafts[selectedRoomId] ?? null : null,
            onDraftChange: handleActiveDraftChange,
            isOffline,
            sendKeyBehavior,
            pendingQueue: pendingQueueForRoom,
            onRetryPending: handleRetryPending,
            onCancelPending: handleCancelPending,
        },
    };

    const handleHiddenPromptClose = useCallback(() => {
        setIsPinPromptOpen(false);
        setPinInput('');
        setPinError(null);
        setPendingHiddenRoomId(null);
    }, []);

    const sidePanelsProps: ChatSidePanelsProps = {
        thread: {
            activeThread,
            selectedRoomId,
            onCloseThread: handleCloseThread,
            client,
            onSendMessage: handleSendMessage,
            onImageClick: setViewingImageUrl,
            sendKeyBehavior,
        },
        settings: {
            isOpen: isSettingsOpen,
            onClose: () => setIsSettingsOpen(false),
            onSave: handleSaveSettings,
            client,
            notificationsEnabled,
            onSetNotificationsEnabled: setNotificationsEnabled,
            chatBackground,
            onSetChatBackground: handleSetChatBackground,
            onResetChatBackground: handleResetChatBackground,
            sendKeyBehavior,
            onSetSendKeyBehavior: handleSendKeyBehaviorChange,
            isPresenceHidden,
            onSetPresenceHidden: setIsPresenceHidden,
            presenceRestricted: hasPresenceRestriction,
            animatedReactionsEnabled,
            onSetAnimatedReactionsEnabled: handleAnimatedReactionsToggle,
        },
        createRoom: {
            isOpen: isCreateRoomOpen,
            onClose: () => setIsCreateRoomOpen(false),
            onCreate: handleCreateRoom,
        },
        createPoll: {
            isOpen: isCreatePollOpen,
            onClose: () => setIsCreatePollOpen(false),
            onCreate: handleCreatePoll,
        },
        manageFolders: {
            isOpen: isManageFoldersOpen,
            onClose: () => setIsManageFoldersOpen(false),
            onSave: handleSaveFolders,
            initialFolders: folders,
            rooms,
        },
        schedule: {
            isOpen: isScheduleModalOpen,
            onClose: () => setIsScheduleModalOpen(false),
            onConfirm: handleConfirmSchedule,
            content: contentToSchedule,
        },
        scheduledList: {
            isOpen: isViewScheduledModalOpen,
            onClose: () => setIsViewScheduledModalOpen(false),
            messages: scheduledForThisRoom,
            onDelete: handleDeleteScheduled,
            onSendNow: handleSendScheduledNow,
            onUpdate: handleUpdateScheduled,
            onBulkReschedule: handleBulkReschedule,
            onBulkSend: handleBulkSendScheduled,
        },
        hiddenRooms: {
            isPromptOpen: isPinPromptOpen,
            pinInput,
            onPinInputChange: (value: string) => {
                setPinInput(value);
                setPinError(null);
            },
            pinError,
            onCancel: handleHiddenPromptClose,
            onUnlockBiometric: appLockState.biometricEnabled ? handleUnlockByBiometric : undefined,
            onUnlockPin: handleUnlockByPin,
            appLockEnabled: appLockState.enabled,
            biometricEnabled: appLockState.biometricEnabled,
        },
        invite: {
            isOpen: isInviteUserOpen,
            onClose: () => setIsInviteUserOpen(false),
            onInvite: handleInviteUser,
            roomName: selectedRoom?.name,
        },
        forwarding: {
            message: forwardingMessage,
            onClose: () => setForwardingMessage(null),
            onForward: handleConfirmForward,
            rooms,
            client,
            savedMessagesRoom,
            currentRoomId: selectedRoomId,
        },
        mediaViewer: {
            imageUrl: viewingImageUrl,
            onClose: () => setViewingImageUrl(null),
        },
        search: {
            isOpen: isSearchOpen,
            onClose: () => setIsSearchOpen(false),
            client,
            rooms,
            onSelectResult: handleJumpToSearchResult,
        },
        plugins: {
            isOpen: isPluginCatalogOpen,
            onClose: () => setIsPluginCatalogOpen(false),
        },
        sharedMedia: {
            isOpen: isSharedMediaOpen,
            onClose: () => setIsSharedMediaOpen(false),
            data: sharedMediaData,
            isLoading: isSharedMediaLoading,
            isPaginating: isSharedMediaPaginating,
            onLoadMore: sharedMediaData?.hasMore ? handleLoadMoreMedia : undefined,
            currentUserId: client.getUserId() || undefined,
        },
        groupCall: {
            activeGroupCall,
            participantViews,
            stageState,
            showParticipantsPanel,
            onToggleParticipantsPanel: () => setShowParticipantsPanel(prev => !prev),
            onLayoutChange: handleLayoutChange,
            onToggleScreenshare: handleToggleScreenShare,
            onToggleMute: handleGroupMuteToggle,
            onToggleVideo: handleGroupVideoToggle,
            onToggleCoWatch: handleToggleCoWatch,
            onMuteParticipant: handleMuteParticipant,
            onVideoParticipantToggle: handleVideoParticipantToggle,
            onRemoveParticipant: handleRemoveParticipant,
            onPromotePresenter: handlePromotePresenter,
            onSpotlightParticipant: handleSpotlightParticipant,
            onRaiseHand: handleRaiseHand,
            onLowerHand: handleLowerHand,
            onBringToStage: handleBringParticipantToStage,
            onSendToAudience: handleSendParticipantToAudience,
            localUserId: client.getUserId() || undefined,
            canModerateParticipants: canStartGroupCall,
            client,
            onHangup: handleCloseGroupCall,
        },
        calls: {
            activeCall,
            incomingCall,
            onHangup: handleHangupCall,
            onAccept: handleAnswerCall,
            onDecline: () => handleHangupCall(true),
            client,
            callSession: accountCallSession,
            onHandover: handleHandoverCall,
            localDeviceId,
        },
        groupCallPermission: {
            error: groupCallPermissionError,
            onDismiss: () => setGroupCallPermissionError(null),
        },
    };

    return (
        <div className="flex h-screen">
            <RoomList
                key={userProfileVersion}
                rooms={rooms}
                selectedRoomId={selectedRoomId}
                onSelectRoom={handleSelectRoom}
                isLoading={isRoomsLoading}
                onLogout={logout}
                client={client}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenPlugins={() => setIsPluginCatalogOpen(true)}
                onOpenCreateRoom={() => setIsCreateRoomOpen(true)}
                folders={folders}
                activeFolderId={activeFolderId}
                onSelectFolder={setActiveFolderId}
                onManageFolders={() => setIsManageFoldersOpen(true)}
                accounts={accountList}
                activeAccountKey={activeAccountKey}
                onSwitchAccount={key => switchAccount(key)}
                onAddAccount={openAddAccount}
                hiddenRoomIds={hiddenRoomIds}
                onUnlockHidden={() => {
                    setPendingHiddenRoomId(hiddenRoomIds[0] ?? null);
                    setPinInput('');
                    setPinError(null);
                    setIsPinPromptOpen(true);
                }}
                isHiddenUnlocked={appLockState.unlocked || !appLockState.enabled}
                presenceSummaries={roomPresenceSummaries}
            />
            <main
                style={{ backgroundImage: chatBackground ? `url(${chatBackground})` : 'none' }}
                className={`flex-1 flex flex-col bg-bg-tertiary relative transition-all duration-300 bg-cover bg-center ${activeThread ? 'w-1/2' : 'w-full'}`}>
                {storiesHydrated && storyGroups.length > 0 && (
                    <StoriesTray client={client} stories={stories} onSelect={handleOpenStory} />
                )}
                {selectedRoom ? (
                    <>
                        <ChatHeader
                            room={selectedRoom}
                            typingUsers={typingUsers}
                            canInvite={canInvite}
                            onOpenInvite={() => setIsInviteUserOpen(true)}
                            pinnedMessage={pinnedMessage}
                            onPinToggle={handlePinToggle}
                            scheduledMessageCount={scheduledForThisRoom.length}
                            onOpenViewScheduled={() => setIsViewScheduledModalOpen(true)}
                            isDirectMessageRoom={selectedRoom.isDirectMessageRoom}
                            onPlaceCall={handlePlaceCall}
                            onStartGroupCall={handleStartGroupCall}
                            canStartGroupCall={canStartGroupCall}
                            groupCallDisabledReason={groupCallDisabledReason || undefined}
                            onToggleScreenShare={activeGroupCall ? handleToggleScreenShare : undefined}
                            onOpenParticipants={activeGroupCall ? () => setShowParticipantsPanel(true) : undefined}
                            participantsCount={activeGroupCall ? participantViews.length : undefined}
                            isScreensharing={Boolean(activeGroupCall?.isScreensharing)}
                            onOpenSearch={() => setIsSearchOpen(true)}
                            onOpenSharedMedia={handleOpenSharedMedia}
                            sharedMediaCount={sharedMediaCount}
                            connectionStatus={isOffline ? 'offline' : 'online'}
                            notificationMode={selectedRoom.notificationMode ?? accountRoomNotificationModes[selectedRoom.roomId] ?? 'all'}
                            onNotificationModeChange={(mode) => handleSetNotificationLevel(selectedRoom.roomId, mode)}
                            onMuteRoom={() => handleMuteRoom(selectedRoom.roomId)}
                            selfDestructSeconds={currentSelfDestructSeconds}
                            onSelfDestructChange={handleSelfDestructChange}
                            isHiddenRoom={selectedRoom.isHidden ?? false}
                            onToggleHiddenRoom={handleToggleHiddenRoom}
                            appLockEnabled={appLockState.enabled}
                            presenceSummary={selectedRoomPresence}
                            presenceHidden={isPresenceHidden}
                            callSession={roomCallSession}
                            onHandoverCall={roomCallSession ? handleHandoverCall : undefined}
                            localDeviceId={localDeviceId}
                        />
                        {catchUpPrompts}
                        <ChatTimelineSection {...timelineProps} />
                        <PluginSurfaceHost
                            location="chat.panel"
                            roomId={selectedRoom.roomId}
                            context={{ roomName: selectedRoom.name }}
                            className="px-4"
                        />
                        <ChatComposerSection {...composerProps} />
                    </>
                ) : <WelcomeView client={client} />}
            </main>

            <ChatSidePanels {...sidePanelsProps} />
            {isStoryViewerOpen && activeStoryGroup && (
                <StoryViewer
                    client={client}
                    stories={activeStoryGroup.stories}
                    initialIndex={activeStoryIndex}
                    onClose={handleCloseStoryViewer}
                    onStorySeen={handleStorySeen}
                    onReact={handleStoryReaction}
                    onRequestNext={handleStoryNext}
                    onRequestPrevious={handleStoryPrevious}
                />
            )}
        </div>
    );
};

export default ChatPage;

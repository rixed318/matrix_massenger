import type { MatrixClient as RealMatrixClient, MatrixEvent as RealMatrixEvent, Room as RealRoom, User as RealUser, MatrixCall as RealMatrixCall } from 'matrix-js-sdk';

export type MatrixClient = RealMatrixClient;
export type MatrixEvent = RealMatrixEvent;
export type MatrixRoom = RealRoom;
export type MatrixUser = RealUser;
export type MatrixCall = RealMatrixCall;

export interface Reaction {
    count: number;
    isOwn: boolean;
    ownEventId?: string;
}

export interface ReplyInfo {
    sender: string;
    body: string;
}

export interface PollOption {
  id: string;
  text: string;
}

export interface PollResult {
  votes: number;
}

export interface Poll {
  question: string;
  options: PollOption[];
  results: Record<string, PollResult>;
  userVote?: string; // The option ID the current user voted for
}


export type RoomNotificationMode = 'all' | 'mentions' | 'mute';

export type RoomHistoryVisibility = 'world_readable' | 'shared' | 'invited' | 'joined';
export type RoomJoinRule = 'public' | 'invite' | 'knock' | 'restricted' | 'knock_restricted';

export interface RoomCreationOptions {
  name: string;
  topic?: string;
  roomAliasName?: string;
  isPublic: boolean;
  isEncrypted: boolean;
  mode: 'chat' | 'channel';
  historyVisibility: RoomHistoryVisibility;
  slowModeSeconds?: number;
  requireInvite: boolean;
  disableFederation: boolean;
  initialPost?: string;
}

export interface Room {
  roomId: string;
  name: string;
  topic?: string;
  avatarUrl: string | null;
  lastMessage: Message | null;
  unreadCount: number;
  pinnedEvents: string[];
  isEncrypted: boolean;
  isDirectMessageRoom: boolean;
  isSavedMessages?: boolean;
  roomType?: string | null;
  isSpace?: boolean;
  spaceChildIds?: string[];
  spaceParentIds?: string[];
  canonicalAlias?: string | null;
  notificationMode?: RoomNotificationMode;
  historyVisibility?: RoomHistoryVisibility | null;
  joinRule?: RoomJoinRule | null;
  isFederationEnabled?: boolean;
  slowModeSeconds?: number | null;
  isHidden?: boolean;
  selfDestructSeconds?: number | null;
  mentionCount?: number;
  scheduledMessageCount?: number;
  secureAlertCount?: number;
  isServiceRoom?: boolean;
}

export interface LinkPreviewData {
    url: string;
    image?: string;
    title?: string;
    description?: string;
    siteName?: string;
}

export interface Message {
  id: string;
  sender: {
    id: string;
    name: string;
    avatarUrl: string | null;
  };
  content: {
    body: string;
    msgtype: string;
    url?: string;
    info?: {
        mimetype: string;
        w?: number;
        h?: number;
        size?: number;
        duration?: number;
        'xyz.amorgan.is_gif'?: boolean;
        thumbnail_url?: string;
        thumbnail_file?: {
            url?: string;
            mimetype?: string;
            size?: number;
            v?: string;
            key_ops?: string[];
            kty?: string;
            key?: string;
            iv?: string;
            hashes?: Record<string, string>;
        };
        thumbnail_info?: {
            mimetype?: string;
            size?: number;
            w?: number;
            h?: number;
        };
    }
    'm.mentions'?: {
        user_ids?: string[];
    }
    formatted_body?: string;
  };
  timestamp: number;
  isOwn: boolean;
  reactions: Record<string, Reaction> | null;
  isEdited: boolean;
  isRedacted: boolean;
  replyTo: ReplyInfo | null;
  readBy: Record<string, { ts: number }>;
  isUploading?: boolean;
  localUrl?: string;
  threadReplyCount: number;
  threadRootId?: string;
  isPinned?: boolean;
  poll?: Poll;
  rawEvent?: MatrixEvent;
  linkPreview?: LinkPreviewData;
  isSticker?: boolean;
  isGif?: boolean;
  selfDestruct?: {
    expiresAt: number;
    ttlMs?: number;
  } | null;
  localThumbnailUrl?: string;
}

export interface ActiveThread {
    rootMessage: Message;
    threadMessages: Message[];
}

export interface Folder {
  id: string;
  name: string;
  roomIds: string[];
}

export type DraftAttachmentKind = 'file' | 'image' | 'audio' | 'voice' | 'sticker' | 'gif' | 'video';

export interface DraftAttachment {
    id: string;
    name: string;
    size: number;
    mimeType: string;
    dataUrl?: string;
    tempUrl?: string;
    url?: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    duration?: number;
    waveform?: number[];
    body?: string;
    msgtype?: string;
    kind: DraftAttachmentKind;
}

export interface VideoMessageMetadata {
    durationMs: number;
    width: number;
    height: number;
    mimeType: string;
    thumbnail: Blob;
    thumbnailMimeType: string;
    thumbnailWidth: number;
    thumbnailHeight: number;
}

export interface DraftContent {
    plain: string;
    formatted?: string;
    attachments: DraftAttachment[];
    msgtype?: string;
}

export interface ScheduledMessageRecurrence {
  /**
   * Mode of recurrence. `once` delivers the message a single time. `repeat`
   * continues to reschedule the message using the provided interval until the
   * limit conditions are reached.
   */
  mode: 'once' | 'repeat';
  /** Interval in milliseconds between occurrences for `repeat` schedules. */
  intervalMs?: number;
  /** Maximum number of deliveries for this schedule (applies to `repeat`). */
  maxOccurrences?: number;
  /** UTC timestamp after which no further deliveries should be planned. */
  untilUtc?: number;
}

export interface ScheduledMessage {
  id: string;
  roomId: string;
  content: DraftContent;
  sendAt: number; // timestamp
  /**
   * Absolute UTC timestamp representation of the scheduled moment. This is stored for
   * compatibility with older clients that only used `sendAt` as a local timestamp.
   */
  sendAtUtc?: number;
  /** Timezone offset (in minutes) of the client that created the schedule. */
  timezoneOffset?: number;
  /** Olson timezone identifier selected by the author (if provided). */
  timezoneId?: string;
  status?: 'pending' | 'retrying' | 'sent';
  attempts?: number;
  lastError?: string;
  sentAt?: number;
  nextRetryAt?: number;
  /** Recurrence metadata for repeating schedules. */
  recurrence?: ScheduledMessageRecurrence;
  /** Number of completed occurrences for recurring schedules. */
  occurrencesCompleted?: number;
  /** Planned UTC timestamp for the next occurrence (if different from `sendAtUtc`). */
  nextOccurrenceAt?: number;
}

export interface StickerInfo {
    w?: number;
    h?: number;
    mimetype?: string;
    size?: number;
    duration?: number;
    thumbnail_url?: string;
    file?: Record<string, any>;
}

export interface Sticker {
    id: string;
    url: string;
    body: string;
    info?: StickerInfo;
    /**
     * Optional list of emoji unicode values suggested when using this asset as a custom emoji.
     */
    emoji?: string[];
    /**
     * Shortcodes or aliases that can be used to trigger this sticker/emoji.
     */
    shortcodes?: string[];
    /** Identifier of the pack this sticker belongs to. */
    packId?: string;
    /**
     * Indicates whether the sticker should behave like an emoji (inline) rather than an attachment.
     */
    isCustomEmoji?: boolean;
}

export type CustomEmoji = Sticker;

export type StickerPackSource = 'local' | 'account_data' | 'room' | 'user';

export interface StickerPack {
    /** Unique identifier for the sticker pack (includes source prefix). */
    id: string;
    name: string;
    description?: string;
    avatarUrl?: string | null;
    attribution?: string;
    isEmojiPack?: boolean;
    source: StickerPackSource;
    roomId?: string;
    creatorUserId?: string;
    stickers: Sticker[];
    isEnabled?: boolean;
    lastUpdated?: number;
}

export interface StickerLibraryState {
    packs: StickerPack[];
    favorites: string[];
    enabledPackIds: string[];
}

export interface Gif {
    id: string;
    url: string;
    previewUrl: string;
    title: string;
    dims: [number, number];
}

export interface GifFavorite extends Gif {
    addedAt: number;
}

export interface GifSearchOptions {
    limit?: number;
    cursor?: string;
    forceRefresh?: boolean;
}

export interface GifSearchResult {
    items: Gif[];
    nextCursor?: string;
    query?: string;
    fromCache: boolean;
    error?: string;
}

export interface GifSearchHistoryEntry {
    query: string;
    timestamp: number;
}

export type SendKeyBehavior = 'enter' | 'ctrlEnter' | 'altEnter';

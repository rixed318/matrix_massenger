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


export interface Room {
  roomId: string;
  name: string;
  avatarUrl: string | null;
  lastMessage: Message | null;
  unreadCount: number;
  pinnedEvents: string[];
  isEncrypted: boolean;
  isDirectMessageRoom: boolean;
  isSavedMessages?: boolean;
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

export interface ScheduledMessage {
  id: string;
  roomId: string;
  content: string;
  sendAt: number; // timestamp
  /**
   * Absolute UTC timestamp representation of the scheduled moment. This is stored for
   * compatibility with older clients that only used `sendAt` as a local timestamp.
   */
  sendAtUtc?: number;
  /** Timezone offset (in minutes) of the client that created the schedule. */
  timezoneOffset?: number;
  status?: 'pending' | 'retrying' | 'sent';
  attempts?: number;
  lastError?: string;
  sentAt?: number;
  nextRetryAt?: number;
}

export interface Sticker {
    id: string;
    url: string;
    body: string;
    info: {
        w: number;
        h: number;
        mimetype: 'image/svg+xml' | 'image/png' | 'image/webp';
        size: number;
    }
}

export interface Gif {
    id: string;
    url: string;
    previewUrl: string;
    title: string;
    dims: [number, number];
}
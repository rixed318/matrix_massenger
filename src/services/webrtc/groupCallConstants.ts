export const GROUP_CALL_STATE_EVENT_TYPE = 'org.matrix.call.group_state';
export const GROUP_CALL_PARTICIPANTS_EVENT_TYPE = 'org.matrix.call.participants';
export const GROUP_CALL_SIGNAL_EVENT_TYPE = 'org.matrix.call.signal';
export const GROUP_CALL_CONTROL_EVENT_TYPE = 'org.matrix.call.control';

export type GroupCallRole =
    | 'host'
    | 'moderator'
    | 'presenter'
    | 'participant'
    | 'listener'
    | 'requesting_speak';

export interface SerializedGroupCallParticipant {
    userId: string;
    displayName: string;
    avatarUrl?: string | null;
    isMuted?: boolean;
    isVideoMuted?: boolean;
    isScreensharing?: boolean;
    isCoWatching?: boolean;
    role?: GroupCallRole;
    sessionId?: string;
    streamId?: string;
    lastActive?: number;
    handRaisedAt?: number | null;
}

export interface GroupCallStageState {
    speakers: string[];
    listeners: string[];
    handRaiseQueue: string[];
    updatedAt: number;
}

export interface GroupCallStateEventContent {
    sessionId: string;
    startedBy: string;
    startedAt: number;
    kind: string;
    url: string;
    topic?: string | null;
    coWatch?: {
        active: boolean;
        url?: string;
        startedBy?: string;
        startedAt?: number;
    } | null;
    participants: SerializedGroupCallParticipant[];
    stage?: GroupCallStageState | null;
}

export interface GroupCallParticipantsContent {
    sessionId: string;
    participants: SerializedGroupCallParticipant[];
    updatedAt: number;
}

export interface GroupCallControlMessage {
    type:
        | 'cowatch-toggle'
        | 'participants-sync'
        | 'screenshare-toggle'
        | 'stage-update'
        | 'stage-invite'
        | 'hand-raise'
        | 'hand-lower';
    payload?: any;
}

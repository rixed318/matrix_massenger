import { MatrixClient, MatrixEvent } from '@matrix-messenger/core';
import { RoomEvent } from 'matrix-js-sdk';
import {
    GROUP_CALL_CONTROL_EVENT_TYPE,
    GROUP_CALL_PARTICIPANTS_EVENT_TYPE,
    GROUP_CALL_SIGNAL_EVENT_TYPE,
    GROUP_CALL_STATE_EVENT_TYPE,
    GroupCallControlMessage,
    GroupCallParticipantsContent,
    GroupCallRole,
    GroupCallStateEventContent,
    GroupCallStageState,
    SerializedGroupCallParticipant,
} from './groupCallConstants';
import { appendCallCaptionEvent, CallCaptionEvent } from '../matrixService';
import { emitRemoteLiveTranscriptionChunk, LiveTranscriptChunk } from '../transcriptionService';
import { recordCallCaption } from '../mediaIndexService';
import { announceCallTranscript } from '../pushService';

export interface GroupCallParticipant extends SerializedGroupCallParticipant {
    stream?: MediaStream | null;
    screenshareStream?: MediaStream | null;
    isLocal?: boolean;
    connectionState?: RTCPeerConnectionState;
}

export interface GroupCallCoordinatorOptions {
    roomId: string;
    sessionId: string;
    client: MatrixClient;
    localMember: {
        userId: string;
        displayName: string;
        avatarUrl?: string | null;
        role?: GroupCallRole;
    };
    constraints?: MediaStreamConstraints;
    iceServers?: RTCIceServer[];
}

interface InternalParticipant extends GroupCallParticipant {
    stream?: MediaStream | null;
    screenshareStream?: MediaStream | null;
    lastSpokeAt?: number;
}

interface EventMap {
    'participants-changed': GroupCallParticipant[];
    'co-watch-changed': GroupCallStateEventContent['coWatch'];
    'screenshare-changed': boolean;
    'stage-changed': GroupCallStageState;
    'error': Error;
    'disposed': void;
}

type EventKey = keyof EventMap;
type EventListener<K extends EventKey> = (payload: EventMap[K]) => void;

class TypedEmitter {
    private listeners: { [K in EventKey]?: Set<EventListener<K>> } = {};

    on<K extends EventKey>(event: K, listener: EventListener<K>): () => void {
        if (!this.listeners[event]) {
            this.listeners[event] = new Set();
        }
        this.listeners[event]!.add(listener as any);
        return () => this.off(event, listener);
    }

    off<K extends EventKey>(event: K, listener: EventListener<K>) {
        this.listeners[event]?.delete(listener as any);
    }

    emit<K extends EventKey>(event: K, payload: EventMap[K]) {
        this.listeners[event]?.forEach(listener => {
            try {
                (listener as EventListener<K>)(payload);
            } catch (error) {
                console.error('GroupCallCoordinator listener failed', error);
            }
        });
    }
}

const randomId = () => `grp_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

interface PendingSignal {
    type: 'offer' | 'answer' | 'ice-candidate';
    payload: any;
}

type CaptionMessage =
    | { type: 'call.caption'; payload: CallCaptionEvent }
    | { type: 'call.caption_translation'; payload: { captionId: string; text: string; targetLanguage: string; sender: string; timestamp: number } }
    | { type: 'call.caption_history'; payload: CallCaptionEvent[] };

export class GroupCallCoordinator {
    readonly roomId: string;
    readonly sessionId: string;
    readonly client: MatrixClient;
    readonly localMember: GroupCallCoordinatorOptions['localMember'];

    private readonly iceServers?: RTCIceServer[];
    private readonly emitter = new TypedEmitter();
    private localStream: MediaStream | null = null;
    private rawLocalStream: MediaStream | null = null;
    private localEffectsController: MediaEffectsController | null = null;
    private localEffectsConfig: VideoEffectsConfiguration = videoEffectsService.getDefaultConfiguration();
    private screenStream: MediaStream | null = null;
    private coWatchState: GroupCallStateEventContent['coWatch'] = { active: false };
    private handRaiseQueue: string[] = [];
    private stageState: GroupCallStageState = {
        speakers: [],
        listeners: [],
        handRaiseQueue: [],
        updatedAt: Date.now(),
    };
    private stateMetadata: { startedBy: string; startedAt: number; kind: string; url: string } = {
        startedBy: '',
        startedAt: 0,
        kind: 'cascade',
        url: '',
    };
    private participants = new Map<string, InternalParticipant>();
    private peers = new Map<string, RTCPeerConnection>();
    private dataChannels = new Map<string, RTCDataChannel>();
    private captionChannels = new Map<string, RTCDataChannel>();
    private pendingSignals = new Map<string, PendingSignal[]>();
    private incomingEffectsControllers = new Map<string, MediaEffectsController>();
    private incomingEffectsConfig = new Map<string, VideoEffectsConfiguration>();
    private incomingStreams = new Map<string, MediaStream>();
    private disposed = false;
    private joinNonce = randomId();
    private scheduleSyncHandle: number | null = null;
    private clientListener?: (event: MatrixEvent) => void;
    private captionHistory: CallCaptionEvent[] = [];

    private constructor(options: GroupCallCoordinatorOptions) {
        this.client = options.client;
        this.roomId = options.roomId;
        this.sessionId = options.sessionId;
        this.localMember = options.localMember;
        this.iceServers = options.iceServers;
        this.stateMetadata = {
            startedBy: options.localMember.userId,
            startedAt: Date.now(),
            kind: 'cascade',
            url: '',
        };
    }

    static async create(options: GroupCallCoordinatorOptions): Promise<GroupCallCoordinator> {
        const coordinator = new GroupCallCoordinator(options);
        await coordinator.initialise(options.constraints);
        return coordinator;
    }

    private async initialise(constraints?: MediaStreamConstraints) {
        try {
            this.rawLocalStream = await navigator.mediaDevices.getUserMedia(constraints || { audio: true, video: true });
            await this.configureLocalEffects();
            this.localStream = this.getEffectiveLocalStream();
        } catch (error) {
            console.error('Failed to acquire local media stream', error);
            this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
            throw error;
        }

        this.participants.set(this.localMember.userId, {
            userId: this.localMember.userId,
            displayName: this.localMember.displayName,
            avatarUrl: this.localMember.avatarUrl,
            role: this.localMember.role ?? 'host',
            isMuted: this.localStream?.getAudioTracks().every(track => !track.enabled) ?? true,
            isVideoMuted: this.localStream?.getVideoTracks().every(track => !track.enabled) ?? true,
            isScreensharing: false,
            isLocal: true,
            stream: this.localStream,
            lastActive: Date.now(),
        });

        this.updateStageState(true);
        this.attachClientListener();
        await this.syncParticipantsState();
        await this.announceJoin();
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    private attachClientListener() {
        const handler = (event: MatrixEvent) => {
            if (event.getRoomId() !== this.roomId) return;
            const eventType = event.getType();
            if (eventType === GROUP_CALL_SIGNAL_EVENT_TYPE) {
                this.handleSignalEvent(event);
            } else if (eventType === GROUP_CALL_PARTICIPANTS_EVENT_TYPE) {
                this.handleParticipantsState(event);
            } else if (eventType === GROUP_CALL_CONTROL_EVENT_TYPE) {
                this.handleControlEvent(event);
            } else if (eventType === GROUP_CALL_STATE_EVENT_TYPE) {
                this.handleStateEvent(event);
            }
        };
        this.client.on(RoomEvent.Timeline, handler);
        this.clientListener = handler;
    }

    private getEffectiveLocalStream(): MediaStream | null {
        return this.localStream ?? this.rawLocalStream;
    }

    private refreshLocalParticipantStream() {
        const stream = this.getEffectiveLocalStream();
        if (!stream) return;
        const participant = this.participants.get(this.localMember.userId);
        if (!participant) return;
        participant.stream = stream;
        participant.isMuted = stream.getAudioTracks().every(track => !track.enabled);
        participant.isVideoMuted = stream.getVideoTracks().every(track => !track.enabled);
        this.participants.set(this.localMember.userId, participant);
    }

    private updateOutgoingSenders(stream: MediaStream) {
        this.peers.forEach(pc => {
            const senders = pc.getSenders();
            senders
                .filter(sender => {
                    if (!sender.track) return false;
                    if (this.screenStream && this.screenStream.getTracks().includes(sender.track)) {
                        return false;
                    }
                    return !stream.getTracks().includes(sender.track);
                })
                .forEach(sender => {
                    void sender.replaceTrack(null);
                });
            stream.getTracks().forEach(track => {
                const existing = senders.find(sender => {
                    if (!sender.track) return false;
                    if (this.screenStream && this.screenStream.getTracks().includes(sender.track)) {
                        return false;
                    }
                    return sender.track.kind === track.kind;
                });
                if (existing) {
                    void existing.replaceTrack(track);
                } else {
                    pc.addTrack(track, stream);
                }
            });
        });
    }

    private async configureLocalEffects(config?: VideoEffectsConfiguration) {
        if (!this.rawLocalStream) {
            return;
        }
        this.localEffectsController?.dispose();
        const nextConfig = config ?? this.localEffectsConfig;
        try {
            this.localEffectsController = await videoEffectsService.create(this.rawLocalStream, nextConfig);
            this.localStream = this.localEffectsController.stream;
            this.localEffectsConfig = nextConfig;
            this.refreshLocalParticipantStream();
            this.updateOutgoingSenders(this.localStream);
        } catch (error) {
            console.warn('Failed to initialise local video effects', error);
            this.localEffectsController = null;
            this.localStream = this.rawLocalStream;
            this.refreshLocalParticipantStream();
            if (this.localStream) {
                this.updateOutgoingSenders(this.localStream);
            }
        }
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    private disposeIncomingController(participantId: string) {
        const existing = this.incomingEffectsControllers.get(participantId);
        if (existing) {
            existing.dispose();
            this.incomingEffectsControllers.delete(participantId);
        }
    }

    private async prepareIncomingStream(participantId: string, stream: MediaStream): Promise<MediaStream> {
        this.incomingStreams.set(participantId, stream);
        const config = this.incomingEffectsConfig.get(participantId);
        this.disposeIncomingController(participantId);
        if (!config) {
            return stream;
        }
        try {
            const controller = await videoEffectsService.create(stream, config);
            this.incomingEffectsControllers.set(participantId, controller);
            return controller.stream;
        } catch (error) {
            console.warn('Failed to apply incoming media effects', error);
            return stream;
        }
    }

    private async handleIncomingTrack(
        remoteUserId: string,
        kind: MediaStreamTrack['kind'],
        stream: MediaStream,
        pc: RTCPeerConnection,
    ) {
        let preparedStream = stream;
        if (kind === 'video') {
            preparedStream = await this.prepareIncomingStream(remoteUserId, stream);
        } else {
            this.incomingStreams.set(remoteUserId, stream);
        }
        const participant = this.participants.get(remoteUserId) || ({
            userId: remoteUserId,
            displayName: remoteUserId,
        } as InternalParticipant);
        if (kind === 'video') {
            participant.stream = preparedStream;
            participant.isVideoMuted = false;
        }
        if (kind === 'audio') {
            participant.isMuted = false;
        }
        participant.connectionState = pc.connectionState;
        participant.lastActive = Date.now();
        this.participants.set(remoteUserId, participant);
        this.scheduleParticipantsSync();
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    private async announceJoin() {
        await this.sendSignal(null, 'join', {
            displayName: this.localMember.displayName,
            avatarUrl: this.localMember.avatarUrl,
            role: this.localMember.role ?? 'host',
        });
    }

    private async announceLeave() {
        await this.sendSignal(null, 'leave', { userId: this.localMember.userId });
    }

    private async sendSignal(target: string | null, type: string, payload: any) {
        if (this.disposed) return;
        try {
            await this.client.sendEvent(this.roomId, GROUP_CALL_SIGNAL_EVENT_TYPE as any, {
                sessionId: this.sessionId,
                target,
                type,
                from: this.localMember.userId,
                payload,
                nonce: this.joinNonce,
            });
        } catch (error) {
            console.error('Failed to send call signal', error);
            this.emitter.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
    }

    private async sendControlMessage(message: GroupCallControlMessage) {
        try {
            await this.client.sendEvent(this.roomId, GROUP_CALL_CONTROL_EVENT_TYPE as any, {
                sessionId: this.sessionId,
                from: this.localMember.userId,
                message,
            });
        } catch (error) {
            console.error('Failed to send control message', error);
        }
    }

    private shouldInitiateFor(remoteUserId: string): boolean {
        const myId = this.localMember.userId;
        return myId < remoteUserId;
    }

    private ensurePeer(remoteUserId: string): RTCPeerConnection {
        let pc = this.peers.get(remoteUserId);
        if (pc) return pc;

        pc = new RTCPeerConnection({ iceServers: this.iceServers });
        this.peers.set(remoteUserId, pc);

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc!.addTrack(track, this.localStream!);
            });
        }
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => {
                pc!.addTrack(track, this.screenStream!);
            });
        }

        pc.onicecandidate = event => {
            if (!event.candidate) return;
            void this.sendSignal(remoteUserId, 'ice-candidate', { candidate: event.candidate });
        };

        pc.ontrack = event => {
            const stream = event.streams[0];
            void this.handleIncomingTrack(remoteUserId, event.track.kind, stream, pc!);
        };

        pc.onconnectionstatechange = () => {
            const state = pc!.connectionState;
            const participant = this.participants.get(remoteUserId);
            if (participant) {
                participant.connectionState = state;
                if (state === 'failed' || state === 'disconnected' || state === 'closed') {
                    participant.stream = null;
                    participant.screenshareStream = null;
                }
                this.participants.set(remoteUserId, participant);
                this.emitter.emit('participants-changed', this.getParticipants());
            }
            if (state === 'failed') {
                pc?.restartIce();
            }
        };

        pc.ondatachannel = event => {
            if (event.channel.label === 'captions') {
                this.setupCaptionChannel(remoteUserId, event.channel);
            } else {
                this.setupDataChannel(remoteUserId, event.channel);
            }
        };

        const controlChannel = pc.createDataChannel('control');
        this.setupDataChannel(remoteUserId, controlChannel);
        const captionChannel = pc.createDataChannel('captions', { ordered: true });
        this.setupCaptionChannel(remoteUserId, captionChannel);

        const pending = this.pendingSignals.get(remoteUserId) || [];
        this.pendingSignals.delete(remoteUserId);
        pending.forEach(signal => {
            void this.consumeSignal(remoteUserId, signal);
        });

        return pc;
    }

    private ensureParticipantRecord(userId: string): InternalParticipant {
        let participant = this.participants.get(userId);
        if (!participant) {
            participant = {
                userId,
                displayName: userId,
                isMuted: true,
                isVideoMuted: true,
                isScreensharing: false,
            } as InternalParticipant;
            this.participants.set(userId, participant);
        }
        return participant;
    }

    private computeStageState(): GroupCallStageState {
        const speakers: string[] = [];
        const listeners: string[] = [];
        const queueSet = new Set(this.handRaiseQueue);

        this.participants.forEach(participant => {
            const role = participant.role ?? 'participant';
            if (role === 'listener') {
                listeners.push(participant.userId);
            } else if (role === 'requesting_speak') {
                if (!queueSet.has(participant.userId)) {
                    this.handRaiseQueue.push(participant.userId);
                    queueSet.add(participant.userId);
                }
            } else {
                speakers.push(participant.userId);
            }
        });

        this.handRaiseQueue = this.handRaiseQueue.filter(userId => {
            const participant = this.participants.get(userId);
            return participant?.role === 'requesting_speak';
        });

        return {
            speakers,
            listeners,
            handRaiseQueue: [...this.handRaiseQueue],
            updatedAt: Date.now(),
        };
    }

    private updateStageState(emit = false): GroupCallStageState {
        const stage = this.computeStageState();
        this.stageState = stage;
        if (emit) {
            this.emitter.emit('stage-changed', stage);
        }
        return stage;
    }

    private broadcastStageUpdate(stage?: GroupCallStageState) {
        const payload = stage ?? this.stageState;
        this.broadcastControl({ type: 'stage-update', payload });
    }

    private applyStageState(stage: Partial<GroupCallStageState> | null | undefined) {
        if (!stage) return;
        if (Array.isArray(stage.handRaiseQueue)) {
            this.handRaiseQueue = stage.handRaiseQueue.filter(userId => this.participants.has(userId));
        }
        if (Array.isArray(stage.listeners)) {
            stage.listeners.forEach(userId => {
                const participant = this.ensureParticipantRecord(userId);
                if (!['host', 'moderator', 'presenter'].includes(participant.role ?? '')) {
                    participant.role = 'listener';
                    participant.handRaisedAt = null;
                }
                this.participants.set(userId, participant);
            });
        }
        if (Array.isArray(stage.handRaiseQueue)) {
            stage.handRaiseQueue.forEach((userId, index) => {
                const participant = this.ensureParticipantRecord(userId);
                if (!['host', 'moderator'].includes(participant.role ?? '')) {
                    participant.role = 'requesting_speak';
                }
                participant.handRaisedAt = participant.handRaisedAt ?? Date.now() + index;
                this.participants.set(userId, participant);
            });
        }
        if (Array.isArray(stage.speakers)) {
            stage.speakers.forEach(userId => {
                const participant = this.ensureParticipantRecord(userId);
                if (participant.role === 'listener' || participant.role === 'requesting_speak') {
                    participant.role = 'participant';
                    participant.handRaisedAt = null;
                }
                this.participants.set(userId, participant);
            });
        }
        this.stageState = {
            speakers: Array.isArray(stage.speakers) ? [...stage.speakers] : this.stageState.speakers,
            listeners: Array.isArray(stage.listeners) ? [...stage.listeners] : this.stageState.listeners,
            handRaiseQueue: Array.isArray(stage.handRaiseQueue)
                ? stage.handRaiseQueue.filter(userId => this.participants.has(userId))
                : [...this.handRaiseQueue],
            updatedAt: stage.updatedAt ?? Date.now(),
        };
        this.emitter.emit('stage-changed', this.stageState);
    }

    private setupDataChannel(remoteUserId: string, channel: RTCDataChannel) {
        this.dataChannels.set(remoteUserId, channel);
        channel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data) as GroupCallControlMessage;
                this.handleControlPayload(remoteUserId, message);
            } catch (error) {
                console.warn('Failed to parse control message', error);
            }
        };
        channel.onopen = () => {
            if (channel.readyState === 'open') {
                const payload: GroupCallControlMessage = {
                    type: 'participants-sync',
                    payload: this.getParticipants().map(p => ({
                        userId: p.userId,
                        isMuted: p.isMuted,
                        isVideoMuted: p.isVideoMuted,
                        isScreensharing: p.isScreensharing,
                    })),
                };
                channel.send(JSON.stringify(payload));
            }
        };
    }

    private setupCaptionChannel(remoteUserId: string, channel: RTCDataChannel) {
        this.captionChannels.set(remoteUserId, channel);
        channel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data) as CaptionMessage;
                this.handleCaptionMessage(remoteUserId, message);
            } catch (error) {
                console.warn('Failed to parse caption message', error);
            }
        };
        channel.onopen = () => {
            if (channel.readyState === 'open') {
                this.sendCaptionHistory(remoteUserId);
            }
        };
        channel.onclose = () => {
            this.captionChannels.delete(remoteUserId);
        };
    }

    private sendCaptionHistory(remoteUserId: string) {
        const channel = this.captionChannels.get(remoteUserId);
        if (!channel || channel.readyState !== 'open' || this.captionHistory.length === 0) {
            return;
        }
        const payload: CaptionMessage = {
            type: 'call.caption_history',
            payload: this.captionHistory.slice(-50),
        };
        try {
            channel.send(JSON.stringify(payload));
        } catch (error) {
            console.warn('Failed to send caption history', error);
        }
    }

    private broadcastCaptionMessage(message: CaptionMessage) {
        const data = JSON.stringify(message);
        this.captionChannels.forEach(channel => {
            if (channel.readyState === 'open') {
                try {
                    channel.send(data);
                } catch (error) {
                    console.warn('Failed to broadcast caption message', error);
                }
            }
        });
    }

    private handleCaptionMessage(remoteUserId: string, message: CaptionMessage) {
        if (message.type === 'call.caption') {
            const event = { ...message.payload, source: 'remote' as const };
            this.ingestCaptionEvent(event);
        } else if (message.type === 'call.caption_translation') {
            this.applyCaptionTranslation({
                captionId: message.payload.captionId,
                text: message.payload.text,
                targetLanguage: message.payload.targetLanguage,
                sender: message.payload.sender ?? remoteUserId,
                timestamp: message.payload.timestamp ?? Date.now(),
            });
        } else if (message.type === 'call.caption_history') {
            const events = Array.isArray(message.payload) ? message.payload : [];
            events.forEach(event => this.ingestCaptionEvent({ ...event, source: 'remote' }));
        }
    }

    private ingestCaptionEvent(event: CallCaptionEvent) {
        const normalized: CallCaptionEvent = {
            ...event,
            callId: event.callId || this.sessionId,
            id: event.id || `${this.sessionId}:${event.timestamp ?? Date.now()}`,
            timestamp: event.timestamp ?? Date.now(),
            final: event.final !== false,
            source: event.source === 'local' ? 'local' : 'remote',
        };
        this.captionHistory.push(normalized);
        this.captionHistory = this.captionHistory.slice(-100);
        appendCallCaptionEvent(this.client, normalized);
        recordCallCaption(this.roomId, {
            id: normalized.id,
            callId: normalized.callId,
            text: normalized.text,
            language: normalized.language,
            translatedText: normalized.translatedText,
            targetLanguage: normalized.targetLanguage,
            timestamp: normalized.timestamp,
            sender: normalized.sender,
        });
        announceCallTranscript({
            callId: normalized.callId,
            roomId: this.roomId,
            text: normalized.translatedText ?? normalized.text,
            language: normalized.language,
            targetLanguage: normalized.targetLanguage,
            timestamp: normalized.timestamp,
            sender: normalized.sender,
        });
        const chunk: LiveTranscriptChunk = {
            callId: normalized.callId,
            chunkId: normalized.id,
            text: normalized.text,
            language: normalized.language,
            timestamp: normalized.timestamp,
            final: normalized.final,
            source: normalized.source,
            translatedText: normalized.translatedText,
            targetLanguage: normalized.targetLanguage,
        };
        emitRemoteLiveTranscriptionChunk(chunk);
    }

    private applyCaptionTranslation(payload: { captionId: string; text: string; targetLanguage: string; sender: string; timestamp: number }) {
        if (!payload.captionId || !payload.text) {
            return;
        }
        const entry = this.captionHistory.find(event => event.id === payload.captionId);
        if (!entry) {
            return;
        }
        entry.translatedText = payload.text;
        entry.targetLanguage = payload.targetLanguage;
        entry.timestamp = payload.timestamp || entry.timestamp;
        appendCallCaptionEvent(this.client, entry);
        recordCallCaption(this.roomId, {
            id: entry.id,
            callId: entry.callId,
            text: entry.text,
            language: entry.language,
            translatedText: entry.translatedText,
            targetLanguage: entry.targetLanguage,
            timestamp: entry.timestamp,
            sender: entry.sender,
        });
        announceCallTranscript({
            callId: entry.callId,
            roomId: this.roomId,
            text: entry.translatedText ?? entry.text,
            language: entry.language,
            targetLanguage: entry.targetLanguage,
            timestamp: entry.timestamp,
            sender: entry.sender,
        });
        emitRemoteLiveTranscriptionChunk({
            callId: entry.callId,
            chunkId: `${entry.id}:translation:${payload.targetLanguage}`,
            text: entry.text,
            language: entry.language,
            timestamp: entry.timestamp,
            final: entry.final,
            source: 'remote',
            translatedText: payload.text,
            targetLanguage: payload.targetLanguage,
        });
    }

    private handleControlPayload(remoteUserId: string, message: GroupCallControlMessage) {
        if (message.type === 'cowatch-toggle') {
            this.coWatchState = message.payload;
            this.emitter.emit('co-watch-changed', this.coWatchState);
        } else if (message.type === 'participants-sync' && Array.isArray(message.payload)) {
            message.payload.forEach((partial: SerializedGroupCallParticipant) => {
                const participant = this.participants.get(partial.userId);
                if (participant) {
                    participant.isMuted = partial.isMuted;
                    participant.isVideoMuted = partial.isVideoMuted;
                    participant.isScreensharing = partial.isScreensharing;
                }
            });
            this.emitter.emit('participants-changed', this.getParticipants());
        } else if (message.type === 'screenshare-toggle') {
            const participant = this.participants.get(remoteUserId);
            if (participant) {
                participant.isScreensharing = Boolean(message.payload?.active);
                this.participants.set(remoteUserId, participant);
                this.emitter.emit('participants-changed', this.getParticipants());
            }
        } else if (message.type === 'stage-update') {
            this.applyStageState(message.payload as GroupCallStageState);
            this.emitter.emit('participants-changed', this.getParticipants());
        } else if (message.type === 'hand-raise') {
            const target: string | undefined = message.payload?.userId;
            if (typeof target === 'string') {
                const participant = this.ensureParticipantRecord(target);
                participant.role = 'requesting_speak';
                participant.handRaisedAt = Date.now();
                if (!this.handRaiseQueue.includes(target)) {
                    this.handRaiseQueue.push(target);
                }
                this.participants.set(target, participant);
                this.updateStageState(true);
                this.emitter.emit('participants-changed', this.getParticipants());
            }
        } else if (message.type === 'hand-lower') {
            const target: string | undefined = message.payload?.userId;
            if (typeof target === 'string') {
                const participant = this.ensureParticipantRecord(target);
                if (!['host', 'moderator'].includes(participant.role ?? '')) {
                    participant.role = 'listener';
                }
                participant.handRaisedAt = null;
                this.participants.set(target, participant);
                this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== target);
                this.updateStageState(true);
                this.emitter.emit('participants-changed', this.getParticipants());
            }
        } else if (message.type === 'stage-invite') {
            const target: string | undefined = message.payload?.target;
            if (typeof target === 'string') {
                const participant = this.ensureParticipantRecord(target);
                participant.role = message.payload?.role ?? 'participant';
                participant.handRaisedAt = null;
                this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== target);
                this.participants.set(target, participant);
                this.updateStageState(true);
                this.emitter.emit('participants-changed', this.getParticipants());
            }
        }
    }

    private async handleSignalEvent(event: MatrixEvent) {
        const content = event.getContent();
        if (!content || content.sessionId !== this.sessionId) return;
        if (content.from === this.localMember.userId) return;
        if (content.target && content.target !== this.localMember.userId) return;

        const remoteUserId: string = content.from;
        const type: string = content.type;
        const payload = content.payload;

        const signal: PendingSignal = { type, payload };
        if (!this.peers.has(remoteUserId) && type !== 'join') {
            const pendingList = this.pendingSignals.get(remoteUserId) || [];
            pendingList.push(signal);
            this.pendingSignals.set(remoteUserId, pendingList);
            return;
        }

        await this.consumeSignal(remoteUserId, signal);
    }

    private async consumeSignal(remoteUserId: string, signal: PendingSignal) {
        switch (signal.type) {
            case 'join':
                this.handleRemoteJoin(remoteUserId, signal.payload);
                break;
            case 'leave':
                this.handleRemoteLeave(remoteUserId);
                break;
            case 'offer':
                await this.handleRemoteOffer(remoteUserId, signal.payload);
                break;
            case 'answer':
                await this.handleRemoteAnswer(remoteUserId, signal.payload);
                break;
            case 'ice-candidate':
                await this.handleRemoteCandidate(remoteUserId, signal.payload);
                break;
            default:
                break;
        }
    }

    private handleRemoteJoin(remoteUserId: string, payload: any) {
        const displayName = payload?.displayName || remoteUserId;
        const avatarUrl = payload?.avatarUrl ?? null;
        const role: GroupCallRole = payload?.role ?? 'listener';
        const participant = this.ensureParticipantRecord(remoteUserId);
        participant.displayName = displayName;
        participant.avatarUrl = avatarUrl;
        participant.role = role;
        if (role === 'requesting_speak') {
            participant.handRaisedAt = participant.handRaisedAt ?? Date.now();
            if (!this.handRaiseQueue.includes(remoteUserId)) {
                this.handRaiseQueue.push(remoteUserId);
            }
        } else {
            participant.handRaisedAt = null;
            this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== remoteUserId);
        }
        this.participants.set(remoteUserId, participant);
        this.emitter.emit('participants-changed', this.getParticipants());

        if (this.shouldInitiateFor(remoteUserId)) {
            void this.startNegotiation(remoteUserId);
        }
        this.scheduleParticipantsSync();
        this.updateStageState(true);
    }

    private handleRemoteLeave(remoteUserId: string) {
        const participant = this.participants.get(remoteUserId);
        if (participant) {
            this.participants.delete(remoteUserId);
            this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== remoteUserId);
            this.emitter.emit('participants-changed', this.getParticipants());
        }
        this.disposeIncomingController(remoteUserId);
        this.incomingEffectsConfig.delete(remoteUserId);
        this.incomingStreams.delete(remoteUserId);
        const pc = this.peers.get(remoteUserId);
        if (pc) {
            pc.close();
            this.peers.delete(remoteUserId);
        }
        this.dataChannels.delete(remoteUserId);
        const captionChannel = this.captionChannels.get(remoteUserId);
        try {
            captionChannel?.close();
        } catch (error) {
            console.warn('Failed to close caption channel', error);
        }
        this.captionChannels.delete(remoteUserId);
        this.updateStageState(true);
    }

    private async startNegotiation(remoteUserId: string) {
        const pc = this.ensurePeer(remoteUserId);
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await this.sendSignal(remoteUserId, 'offer', { sdp: offer });
        } catch (error) {
            console.error('Failed to create offer', error);
        }
    }

    private async handleRemoteOffer(remoteUserId: string, payload: any) {
        const pc = this.ensurePeer(remoteUserId);
        const offer: RTCSessionDescriptionInit = payload?.sdp;
        if (!offer) return;
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await this.sendSignal(remoteUserId, 'answer', { sdp: answer });
        } catch (error) {
            console.error('Failed handling remote offer', error);
        }
    }

    private async handleRemoteAnswer(remoteUserId: string, payload: any) {
        const pc = this.peers.get(remoteUserId);
        if (!pc) return;
        const answer: RTCSessionDescriptionInit = payload?.sdp;
        if (!answer) return;
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
            console.error('Failed to apply remote answer', error);
        }
    }

    private async handleRemoteCandidate(remoteUserId: string, payload: any) {
        const pc = this.peers.get(remoteUserId);
        if (!pc) {
            const pendingList = this.pendingSignals.get(remoteUserId) || [];
            pendingList.push({ type: 'ice-candidate', payload });
            this.pendingSignals.set(remoteUserId, pendingList);
            return;
        }
        const candidate = payload?.candidate;
        if (!candidate) return;
        try {
            await pc.addIceCandidate(candidate);
        } catch (error) {
            console.error('Failed to add ICE candidate', error);
        }
    }

    private handleParticipantsState(event: MatrixEvent) {
        const content = event.getContent() as GroupCallParticipantsContent;
        if (!content || content.sessionId !== this.sessionId) return;
        if (!Array.isArray(content.participants)) return;
        content.participants.forEach(entry => {
            const existing = this.participants.get(entry.userId);
            if (existing) {
                existing.isMuted = entry.isMuted ?? existing.isMuted;
                existing.isVideoMuted = entry.isVideoMuted ?? existing.isVideoMuted;
                existing.isScreensharing = entry.isScreensharing ?? existing.isScreensharing;
                existing.role = entry.role ?? existing.role;
                existing.displayName = entry.displayName ?? existing.displayName;
                existing.avatarUrl = entry.avatarUrl ?? existing.avatarUrl;
                existing.lastActive = entry.lastActive ?? existing.lastActive;
                existing.handRaisedAt = entry.handRaisedAt ?? existing.handRaisedAt;
                this.participants.set(entry.userId, existing);
            } else {
                this.participants.set(entry.userId, {
                    ...entry,
                });
            }
            const participant = this.participants.get(entry.userId);
            if (!participant) return;
            if (participant.role === 'requesting_speak') {
                participant.handRaisedAt = participant.handRaisedAt ?? entry.handRaisedAt ?? Date.now();
                if (!this.handRaiseQueue.includes(participant.userId)) {
                    this.handRaiseQueue.push(participant.userId);
                }
            } else {
                participant.handRaisedAt = null;
                this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== participant.userId);
            }
            this.participants.set(participant.userId, participant);
        });
        this.emitter.emit('participants-changed', this.getParticipants());
        this.updateStageState(true);
    }

    private handleControlEvent(event: MatrixEvent) {
        const content = event.getContent();
        if (!content || content.sessionId !== this.sessionId) return;
        if (!content.message) return;
        this.handleControlPayload(event.getSender() || 'unknown', content.message as GroupCallControlMessage);
    }

    private handleStateEvent(event: MatrixEvent) {
        const content = event.getContent() as GroupCallStateEventContent;
        if (!content || content.sessionId !== this.sessionId) return;
        this.stateMetadata = {
            startedBy: content.startedBy ?? this.stateMetadata.startedBy,
            startedAt: content.startedAt ?? this.stateMetadata.startedAt,
            kind: content.kind ?? this.stateMetadata.kind,
            url: content.url ?? this.stateMetadata.url,
        };
        if (content.coWatch) {
            this.coWatchState = content.coWatch;
            this.emitter.emit('co-watch-changed', this.coWatchState);
        }
        if (content.stage) {
            this.applyStageState(content.stage);
        }
    }

    private scheduleParticipantsSync() {
        if (this.scheduleSyncHandle) {
            window.clearTimeout(this.scheduleSyncHandle);
        }
        this.scheduleSyncHandle = window.setTimeout(() => {
            void this.syncParticipantsState();
        }, 350);
    }

    private async syncParticipantsState() {
        if (this.disposed) return;
        const room = this.client.getRoom(this.roomId);
        if (!room) return;
        const participants = this.getParticipants().map(participant => ({
            userId: participant.userId,
            displayName: participant.displayName,
            avatarUrl: participant.avatarUrl,
            isMuted: participant.isMuted,
            isVideoMuted: participant.isVideoMuted,
            isScreensharing: participant.isScreensharing,
            isCoWatching: participant.isCoWatching,
            role: participant.role,
            lastActive: participant.lastActive,
            handRaisedAt: participant.handRaisedAt ?? null,
        }));
        const stage = this.updateStageState(true);
        try {
            await this.client.sendStateEvent(this.roomId, GROUP_CALL_PARTICIPANTS_EVENT_TYPE as any, {
                sessionId: this.sessionId,
                participants,
                updatedAt: Date.now(),
            }, this.sessionId);
        } catch (error) {
            console.error('Failed to sync participants', error);
        }
        try {
            await this.client.sendStateEvent(
                this.roomId,
                GROUP_CALL_STATE_EVENT_TYPE as any,
                {
                    sessionId: this.sessionId,
                    startedBy: this.stateMetadata.startedBy,
                    startedAt: this.stateMetadata.startedAt || Date.now(),
                    kind: this.stateMetadata.kind,
                    url: this.stateMetadata.url,
                    participants,
                    coWatch: this.coWatchState,
                    stage,
                } as GroupCallStateEventContent,
                this.sessionId,
            );
        } catch (error) {
            console.error('Failed to sync stage state', error);
        }
        this.broadcastStageUpdate(stage);
    }

    getLocalStream(): MediaStream | null {
        return this.localStream;
    }

    getLocalEffectsConfiguration(): VideoEffectsConfiguration {
        return cloneEffectsConfig(this.localEffectsConfig);
    }

    async setLocalEffectsConfiguration(config: VideoEffectsConfiguration): Promise<void> {
        this.localEffectsConfig = cloneEffectsConfig(config);
        await this.configureLocalEffects(this.localEffectsConfig);
    }

    getIncomingEffectsConfiguration(participantId: string): VideoEffectsConfiguration | null {
        const config = this.incomingEffectsConfig.get(participantId);
        return config ? cloneEffectsConfig(config) : null;
    }

    async setIncomingEffectsConfiguration(
        participantId: string,
        config: VideoEffectsConfiguration | null,
    ): Promise<void> {
        if (!config) {
            this.incomingEffectsConfig.delete(participantId);
            this.disposeIncomingController(participantId);
            const original = this.incomingStreams.get(participantId);
            if (original) {
                const participant = this.participants.get(participantId);
                if (participant) {
                    participant.stream = original;
                    participant.isVideoMuted = original.getVideoTracks().every(track => !track.enabled);
                    this.participants.set(participantId, participant);
                    this.emitter.emit('participants-changed', this.getParticipants());
                }
            }
            return;
        }
        const cloned = cloneEffectsConfig(config);
        this.incomingEffectsConfig.set(participantId, cloned);
        const stream = this.incomingStreams.get(participantId);
        if (!stream) {
            return;
        }
        const processed = await this.prepareIncomingStream(participantId, stream);
        const participant = this.participants.get(participantId);
        if (participant) {
            participant.stream = processed;
            participant.isVideoMuted = processed.getVideoTracks().every(track => !track.enabled);
            this.participants.set(participantId, participant);
            this.emitter.emit('participants-changed', this.getParticipants());
        }
    }

    getParticipants(): GroupCallParticipant[] {
        return Array.from(this.participants.values()).map(participant => ({ ...participant }));
    }

    on<K extends EventKey>(event: K, listener: EventListener<K>): () => void {
        return this.emitter.on(event, listener);
    }

    async toggleMute() {
        if (!this.localStream) return;
        const audioTrack = this.localStream.getAudioTracks()[0];
        if (!audioTrack) return;
        const nextEnabled = !audioTrack.enabled;
        audioTrack.enabled = nextEnabled;
        this.rawLocalStream?.getAudioTracks().forEach(track => {
            track.enabled = nextEnabled;
        });
        const participant = this.participants.get(this.localMember.userId);
        if (participant) {
            participant.isMuted = !nextEnabled;
            this.participants.set(this.localMember.userId, participant);
        }
        this.scheduleParticipantsSync();
        this.broadcastControl({
            type: 'participants-sync',
            payload: [{ userId: this.localMember.userId, isMuted: participant?.isMuted }],
        });
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    async toggleVideo() {
        if (!this.localStream) return;
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (!videoTrack) return;
        const nextEnabled = !videoTrack.enabled;
        videoTrack.enabled = nextEnabled;
        this.rawLocalStream?.getVideoTracks().forEach(track => {
            track.enabled = nextEnabled;
        });
        const participant = this.participants.get(this.localMember.userId);
        if (participant) {
            participant.isVideoMuted = !nextEnabled;
            this.participants.set(this.localMember.userId, participant);
        }
        this.scheduleParticipantsSync();
        this.broadcastControl({
            type: 'participants-sync',
            payload: [{ userId: this.localMember.userId, isVideoMuted: participant?.isVideoMuted }],
        });
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    async toggleScreenshare() {
        if (this.screenStream) {
            this.stopScreenshare();
            return;
        }
        try {
            this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const participant = this.participants.get(this.localMember.userId);
            if (participant) {
                participant.isScreensharing = true;
                participant.screenshareStream = this.screenStream;
                this.participants.set(this.localMember.userId, participant);
            }
            this.screenStream.getTracks().forEach(track => {
                this.peers.forEach(pc => {
                    const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
                    if (sender) {
                        void sender.replaceTrack(track);
                    } else {
                        pc.addTrack(track, this.screenStream!);
                    }
                });
            });
            this.screenStream.getVideoTracks()[0]?.addEventListener('ended', () => {
                this.stopScreenshare();
            });
            this.scheduleParticipantsSync();
            this.broadcastControl({ type: 'screenshare-toggle', payload: { active: true } });
            this.emitter.emit('screenshare-changed', true);
            this.emitter.emit('participants-changed', this.getParticipants());
        } catch (error) {
            console.error('Failed to start screen share', error);
        }
    }

    private stopScreenshare() {
        if (!this.screenStream) return;
        this.screenStream.getTracks().forEach(track => track.stop());
        this.screenStream = null;
        const participant = this.participants.get(this.localMember.userId);
        if (participant) {
            participant.isScreensharing = false;
            participant.screenshareStream = null;
            this.participants.set(this.localMember.userId, participant);
        }
        this.broadcastControl({ type: 'screenshare-toggle', payload: { active: false } });
        this.scheduleParticipantsSync();
        this.emitter.emit('screenshare-changed', false);
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    async toggleCoWatch(url?: string) {
        this.coWatchState = {
            active: !this.coWatchState?.active,
            url: this.coWatchState?.active ? undefined : url,
            startedBy: this.localMember.userId,
            startedAt: Date.now(),
        };
        await this.client.sendStateEvent(this.roomId, GROUP_CALL_STATE_EVENT_TYPE as any, {
            sessionId: this.sessionId,
            startedBy: this.localMember.userId,
            startedAt: Date.now(),
            kind: 'cascade',
            url: '',
            participants: [],
            coWatch: this.coWatchState,
            stage: this.stageState,
        } as GroupCallStateEventContent, this.sessionId);
        this.broadcastControl({ type: 'cowatch-toggle', payload: this.coWatchState });
        this.emitter.emit('co-watch-changed', this.coWatchState);
    }

    getStageState(): GroupCallStageState {
        return {
            speakers: [...this.stageState.speakers],
            listeners: [...this.stageState.listeners],
            handRaiseQueue: [...this.handRaiseQueue],
            updatedAt: this.stageState.updatedAt,
        };
    }

    getHandRaiseQueue(): string[] {
        return [...this.handRaiseQueue];
    }

    raiseHand() {
        const userId = this.localMember.userId;
        const participant = this.ensureParticipantRecord(userId);
        if (['host', 'moderator', 'presenter', 'participant'].includes(participant.role ?? 'participant')) {
            return;
        }
        if (participant.role === 'requesting_speak') {
            this.lowerHand(userId);
            return;
        }
        participant.role = 'requesting_speak';
        participant.handRaisedAt = Date.now();
        this.participants.set(userId, participant);
        if (!this.handRaiseQueue.includes(userId)) {
            this.handRaiseQueue.push(userId);
        }
        const stage = this.updateStageState(true);
        this.scheduleParticipantsSync();
        this.broadcastControl({ type: 'hand-raise', payload: { userId } });
        this.broadcastStageUpdate(stage);
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    lowerHand(participantId: string = this.localMember.userId) {
        const participant = this.participants.get(participantId);
        if (!participant) return;
        if (participant.role === 'requesting_speak' || participant.role === 'listener') {
            if (!['host', 'moderator'].includes(participant.role ?? '')) {
                participant.role = 'listener';
            }
            participant.handRaisedAt = null;
            this.participants.set(participantId, participant);
        }
        const queueBefore = this.handRaiseQueue.length;
        this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== participantId);
        const stage = this.updateStageState(true);
        this.scheduleParticipantsSync();
        if (participantId === this.localMember.userId || queueBefore !== this.handRaiseQueue.length) {
            this.broadcastControl({ type: 'hand-lower', payload: { userId: participantId } });
        }
        this.broadcastStageUpdate(stage);
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    bringParticipantToStage(participantId: string, promotedRole: GroupCallRole = 'participant') {
        const participant = this.ensureParticipantRecord(participantId);
        if (['host', 'moderator'].includes(participant.role ?? '') && promotedRole === 'listener') {
            return;
        }
        participant.role = promotedRole;
        participant.handRaisedAt = null;
        this.participants.set(participantId, participant);
        this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== participantId);
        const stage = this.updateStageState(true);
        this.scheduleParticipantsSync();
        this.broadcastControl({ type: 'stage-invite', payload: { target: participantId, role: promotedRole } });
        this.broadcastStageUpdate(stage);
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    moveParticipantToAudience(participantId: string) {
        const participant = this.ensureParticipantRecord(participantId);
        if (['host', 'moderator'].includes(participant.role ?? '')) {
            return;
        }
        participant.role = 'listener';
        participant.handRaisedAt = null;
        this.participants.set(participantId, participant);
        this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== participantId);
        const stage = this.updateStageState(true);
        this.scheduleParticipantsSync();
        this.broadcastControl({ type: 'hand-lower', payload: { userId: participantId } });
        this.broadcastStageUpdate(stage);
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    setParticipantMuted(participantId: string, muted: boolean) {
        const participant = this.participants.get(participantId);
        if (participant) {
            participant.isMuted = muted;
            this.participants.set(participantId, participant);
            this.scheduleParticipantsSync();
            this.emitter.emit('participants-changed', this.getParticipants());
        }
        this.broadcastControl({
            type: 'participants-sync',
            payload: [{ userId: participantId, isMuted: muted, requestedBy: this.localMember.userId }],
        });
    }

    setParticipantVideoMuted(participantId: string, muted: boolean) {
        const participant = this.participants.get(participantId);
        if (participant) {
            participant.isVideoMuted = muted;
            this.participants.set(participantId, participant);
            this.scheduleParticipantsSync();
            this.emitter.emit('participants-changed', this.getParticipants());
        }
        this.broadcastControl({
            type: 'participants-sync',
            payload: [{ userId: participantId, isVideoMuted: muted, requestedBy: this.localMember.userId }],
        });
    }

    promoteParticipant(participantId: string) {
        this.bringParticipantToStage(participantId, 'presenter');
    }

    async kickParticipant(participantId: string) {
        const participant = this.participants.get(participantId);
        if (!participant) return;
        this.participants.delete(participantId);
        this.handRaiseQueue = this.handRaiseQueue.filter(id => id !== participantId);
        const pc = this.peers.get(participantId);
        pc?.close();
        this.peers.delete(participantId);
        this.dataChannels.delete(participantId);
        this.disposeIncomingController(participantId);
        this.incomingEffectsConfig.delete(participantId);
        this.incomingStreams.delete(participantId);
        this.scheduleParticipantsSync();
        this.updateStageState(true);
        this.broadcastStageUpdate();
        this.emitter.emit('participants-changed', this.getParticipants());
        await this.sendSignal(participantId, 'leave', { by: this.localMember.userId, reason: 'kick' });
    }

    private broadcastControl(message: GroupCallControlMessage) {
        this.dataChannels.forEach(channel => {
            if (channel.readyState === 'open') {
                channel.send(JSON.stringify(message));
            }
        });
        void this.sendControlMessage(message);
    }

    public publishCaption(text: string, options: {
        id?: string;
        language?: string;
        final?: boolean;
        translatedText?: string;
        targetLanguage?: string;
    } = {}): CallCaptionEvent {
        const event: CallCaptionEvent = {
            id: options.id || `${this.sessionId}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
            callId: this.sessionId,
            sender: this.localMember.userId,
            text,
            language: options.language,
            translatedText: options.translatedText,
            targetLanguage: options.targetLanguage,
            timestamp: Date.now(),
            final: options.final !== false,
            source: 'local',
        };
        this.ingestCaptionEvent(event);
        this.broadcastCaptionMessage({ type: 'call.caption', payload: event });
        return event;
    }

    public publishCaptionTranslation(captionId: string, text: string, targetLanguage: string) {
        if (!captionId || !text || !targetLanguage) {
            return;
        }
        const payload = {
            captionId,
            text,
            targetLanguage,
            sender: this.localMember.userId,
            timestamp: Date.now(),
        };
        this.applyCaptionTranslation(payload);
        this.broadcastCaptionMessage({ type: 'call.caption_translation', payload });
    }

    async leave() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.clientListener) {
            this.client.removeListener(RoomEvent.Timeline, this.clientListener);
        }
        await this.announceLeave();
        this.broadcastControl({ type: 'participants-sync', payload: [{ userId: this.localMember.userId, left: true }] });
        this.localEffectsController?.dispose();
        this.localEffectsController = null;
        this.incomingEffectsControllers.forEach(controller => controller.dispose());
        this.incomingEffectsControllers.clear();
        this.incomingStreams.clear();
        this.localStream?.getTracks().forEach(track => track.stop());
        this.rawLocalStream?.getTracks().forEach(track => track.stop());
        this.screenStream?.getTracks().forEach(track => track.stop());
        this.peers.forEach(pc => pc.close());
        this.peers.clear();
        this.dataChannels.clear();
        this.captionChannels.forEach(channel => {
            try {
                channel.close();
            } catch (error) {
                console.warn('Failed to close caption channel on leave', error);
            }
        });
        this.captionChannels.clear();
        this.captionHistory = [];
        this.handRaiseQueue = [];
        this.stageState = {
            speakers: [],
            listeners: [],
            handRaiseQueue: [],
            updatedAt: Date.now(),
        };
        this.emitter.emit('disposed', undefined);
    }
}

export default GroupCallCoordinator;

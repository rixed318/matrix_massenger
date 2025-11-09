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
    SerializedGroupCallParticipant,
} from './groupCallConstants';

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

export class GroupCallCoordinator {
    readonly roomId: string;
    readonly sessionId: string;
    readonly client: MatrixClient;
    readonly localMember: GroupCallCoordinatorOptions['localMember'];

    private readonly iceServers?: RTCIceServer[];
    private readonly emitter = new TypedEmitter();
    private localStream: MediaStream | null = null;
    private screenStream: MediaStream | null = null;
    private coWatchState: GroupCallStateEventContent['coWatch'] = { active: false };
    private participants = new Map<string, InternalParticipant>();
    private peers = new Map<string, RTCPeerConnection>();
    private dataChannels = new Map<string, RTCDataChannel>();
    private pendingSignals = new Map<string, PendingSignal[]>();
    private disposed = false;
    private joinNonce = randomId();
    private scheduleSyncHandle: number | null = null;
    private clientListener?: (event: MatrixEvent) => void;

    private constructor(options: GroupCallCoordinatorOptions) {
        this.client = options.client;
        this.roomId = options.roomId;
        this.sessionId = options.sessionId;
        this.localMember = options.localMember;
        this.iceServers = options.iceServers;
    }

    static async create(options: GroupCallCoordinatorOptions): Promise<GroupCallCoordinator> {
        const coordinator = new GroupCallCoordinator(options);
        await coordinator.initialise(options.constraints);
        return coordinator;
    }

    private async initialise(constraints?: MediaStreamConstraints) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints || { audio: true, video: true });
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
            isMuted: this.localStream.getAudioTracks().every(track => !track.enabled),
            isVideoMuted: this.localStream.getVideoTracks().every(track => !track.enabled),
            isScreensharing: false,
            isLocal: true,
            stream: this.localStream,
            lastActive: Date.now(),
        });

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
            const participant = this.participants.get(remoteUserId) || {
                userId: remoteUserId,
                displayName: remoteUserId,
            } as InternalParticipant;
            if (event.track.kind === 'video') {
                participant.stream = stream;
                participant.isVideoMuted = false;
            }
            if (event.track.kind === 'audio') {
                participant.isMuted = false;
            }
            participant.connectionState = pc!.connectionState;
            participant.lastActive = Date.now();
            this.participants.set(remoteUserId, participant);
            this.scheduleParticipantsSync();
            this.emitter.emit('participants-changed', this.getParticipants());
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
            this.setupDataChannel(remoteUserId, event.channel);
        };

        const channel = pc.createDataChannel('control');
        this.setupDataChannel(remoteUserId, channel);

        const pending = this.pendingSignals.get(remoteUserId) || [];
        this.pendingSignals.delete(remoteUserId);
        pending.forEach(signal => {
            void this.consumeSignal(remoteUserId, signal);
        });

        return pc;
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
        const role: GroupCallRole = payload?.role ?? 'participant';
        const existing = this.participants.get(remoteUserId);
        if (!existing) {
            this.participants.set(remoteUserId, {
                userId: remoteUserId,
                displayName,
                avatarUrl,
                role,
                isMuted: true,
                isVideoMuted: true,
                isScreensharing: false,
            });
        }
        this.emitter.emit('participants-changed', this.getParticipants());

        if (this.shouldInitiateFor(remoteUserId)) {
            void this.startNegotiation(remoteUserId);
        }
        this.scheduleParticipantsSync();
    }

    private handleRemoteLeave(remoteUserId: string) {
        const participant = this.participants.get(remoteUserId);
        if (participant) {
            this.participants.delete(remoteUserId);
            this.emitter.emit('participants-changed', this.getParticipants());
        }
        const pc = this.peers.get(remoteUserId);
        if (pc) {
            pc.close();
            this.peers.delete(remoteUserId);
        }
        this.dataChannels.delete(remoteUserId);
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
            } else {
                this.participants.set(entry.userId, {
                    ...entry,
                });
            }
        });
        this.emitter.emit('participants-changed', this.getParticipants());
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
        if (content.coWatch) {
            this.coWatchState = content.coWatch;
            this.emitter.emit('co-watch-changed', this.coWatchState);
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
        }));
        try {
            await this.client.sendStateEvent(this.roomId, GROUP_CALL_PARTICIPANTS_EVENT_TYPE as any, {
                sessionId: this.sessionId,
                participants,
                updatedAt: Date.now(),
            }, this.sessionId);
        } catch (error) {
            console.error('Failed to sync participants', error);
        }
    }

    getLocalStream(): MediaStream | null {
        return this.localStream;
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
        audioTrack.enabled = !audioTrack.enabled;
        const participant = this.participants.get(this.localMember.userId);
        if (participant) {
            participant.isMuted = !audioTrack.enabled;
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
        videoTrack.enabled = !videoTrack.enabled;
        const participant = this.participants.get(this.localMember.userId);
        if (participant) {
            participant.isVideoMuted = !videoTrack.enabled;
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
        } as GroupCallStateEventContent, this.sessionId);
        this.broadcastControl({ type: 'cowatch-toggle', payload: this.coWatchState });
        this.emitter.emit('co-watch-changed', this.coWatchState);
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
        const participant = this.participants.get(participantId);
        if (!participant) return;
        participant.role = 'presenter';
        this.participants.set(participantId, participant);
        this.scheduleParticipantsSync();
        this.emitter.emit('participants-changed', this.getParticipants());
    }

    async kickParticipant(participantId: string) {
        const participant = this.participants.get(participantId);
        if (!participant) return;
        this.participants.delete(participantId);
        const pc = this.peers.get(participantId);
        pc?.close();
        this.peers.delete(participantId);
        this.dataChannels.delete(participantId);
        this.scheduleParticipantsSync();
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

    async leave() {
        if (this.disposed) return;
        this.disposed = true;
        if (this.clientListener) {
            this.client.removeListener(RoomEvent.Timeline, this.clientListener);
        }
        await this.announceLeave();
        this.broadcastControl({ type: 'participants-sync', payload: [{ userId: this.localMember.userId, left: true }] });
        this.localStream?.getTracks().forEach(track => track.stop());
        this.screenStream?.getTracks().forEach(track => track.stop());
        this.peers.forEach(pc => pc.close());
        this.peers.clear();
        this.dataChannels.clear();
        this.emitter.emit('disposed', undefined);
    }
}

export default GroupCallCoordinator;

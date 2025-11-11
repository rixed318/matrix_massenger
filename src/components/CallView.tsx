import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MatrixCall, MatrixClient, CallSessionState, updateLocalCallDeviceState } from '@matrix-messenger/core';
import Avatar from './Avatar';
import { mxcToHttp } from '@matrix-messenger/core';
import { CallEvent } from 'matrix-js-sdk';
import CallParticipantsPanel, { Participant as CallParticipant } from './CallParticipantsPanel';
import { GroupCallStageState } from '../services/webrtc/groupCallConstants';
import GroupCallCoordinator from '../services/webrtc/groupCallCoordinator';
import {
    startLiveTranscriptionSession,
    stopLiveTranscriptionSession,
    subscribeLiveTranscription,
    translateCaption,
    LiveTranscriptChunk,
    getTranscriptionRuntimeConfig,
} from '../services/transcriptionService';

export type CallLayout = 'spotlight' | 'grid';

interface ExtendedParticipant extends CallParticipant {
    stream?: MediaStream | null;
    screenshareStream?: MediaStream | null;
    dominant?: boolean;
    effectsEnabled?: boolean;
}

interface CallViewProps {
    call?: MatrixCall | null;
    onHangup: () => void;
    client: MatrixClient;
    participants?: ExtendedParticipant[];
    stageState?: GroupCallStageState | null;
    layout?: CallLayout;
    onLayoutChange?: (layout: CallLayout) => void;
    showParticipantsPanel?: boolean;
    onToggleParticipantsPanel?: () => void;
    onToggleScreenshare?: () => void;
    onToggleLocalMute?: () => void;
    onToggleLocalVideo?: () => void;
    isScreensharing?: boolean;
    isMuted?: boolean;
    isVideoMuted?: boolean;
    onToggleCoWatch?: () => void;
    coWatchActive?: boolean;
    headerTitle?: string;
    onMuteParticipant?: (participantId: string) => void;
    onVideoParticipantToggle?: (participantId: string) => void;
    onRemoveParticipant?: (participantId: string) => void;
    onPromotePresenter?: (participantId: string) => void;
    onSpotlightParticipant?: (participantId: string) => void;
    onRaiseHand?: () => void;
    onLowerHand?: (participantId?: string) => void;
    onBringParticipantToStage?: (participantId: string) => void;
    onSendParticipantToAudience?: (participantId: string) => void;
    localUserId?: string;
    canModerateParticipants?: boolean;
    callSession?: CallSessionState | null;
    onHandover?: () => void;
    localDeviceId?: string | null;
    coordinator?: GroupCallCoordinator | null;
}

interface VideoTileInfo {
    id: string;
    baseId: string;
    name: string;
    mediaStream: MediaStream | null | undefined;
    isLocal?: boolean;
    isMuted?: boolean;
    isVideoMuted?: boolean;
    isScreenShare?: boolean;
    avatarUrl?: string | null;
}

const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
};

const VideoTile: React.FC<{ tile: VideoTileInfo; localMuted: boolean; compact?: boolean }> = ({ tile, localMuted, compact }) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const element = videoRef.current;
        if (!element) return;
        if (tile.mediaStream) {
            try {
                (element as HTMLVideoElement).srcObject = tile.mediaStream;
            } catch (error) {
                (element as HTMLVideoElement).srcObject = null;
                element.src = '';
            }
            void element.play().catch(() => undefined);
        } else {
            (element as HTMLVideoElement).srcObject = null;
        }
    }, [tile.mediaStream]);

    const placeholder = tile.name.slice(0, 2).toUpperCase();

    return (
        <div className={`relative rounded-xl overflow-hidden bg-black ${compact ? 'aspect-video min-h-[160px]' : 'aspect-video min-h-[200px]'}`}>
            {tile.mediaStream ? (
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={tile.isLocal || tile.isScreenShare || localMuted}
                    className="h-full w-full object-cover"
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center bg-bg-tertiary text-3xl font-semibold text-text-secondary">
                    {placeholder}
                </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black/45 backdrop-blur-sm px-3 py-2 text-xs text-white flex items-center justify-between">
                <span className="truncate max-w-[70%]">{tile.name}</span>
                <span className="flex items-center gap-2">
                    {tile.isMuted ? '🔇' : '🎙️'}
                    {tile.isScreenShare ? '🖥️' : tile.isVideoMuted ? '📷 off' : '📷 on'}
                </span>
            </div>
        </div>
    );
};

const CallView: React.FC<CallViewProps> = ({
    call,
    onHangup,
    client,
    participants,
    stageState,
    layout = 'grid',
    onLayoutChange,
    showParticipantsPanel,
    onToggleParticipantsPanel,
    onToggleScreenshare,
    onToggleLocalMute,
    onToggleLocalVideo,
    isScreensharing = false,
    isMuted: mutedProp,
    isVideoMuted: videoMutedProp,
    onToggleCoWatch,
    coWatchActive = false,
    headerTitle,
    onMuteParticipant,
    onVideoParticipantToggle,
    onRemoveParticipant,
    onPromotePresenter,
    onSpotlightParticipant,
    onRaiseHand,
    onLowerHand,
    onBringParticipantToStage,
    onSendParticipantToAudience,
    localUserId,
    canModerateParticipants = false,
    callSession,
    onHandover,
    localDeviceId,
    coordinator,
}) => {
    const [callState, setCallState] = useState<string>(call?.state ?? '');
    const [duration, setDuration] = useState(0);
    const [internalMuted, setInternalMuted] = useState(call?.isMicrophoneMuted() ?? false);
    const [internalVideoMuted, setInternalVideoMuted] = useState(call?.isLocalVideoMuted() ?? false);
    const durationIntervalRef = useRef<number | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const [liveCaptions, setLiveCaptions] = useState<Record<string, LiveTranscriptChunk>>({});
    const [captionOrder, setCaptionOrder] = useState<string[]>([]);
    const [captionLanguage, setCaptionLanguage] = useState<string>('auto');
    const [captionTargetLanguage, setCaptionTargetLanguage] = useState<string>('');
    const [captionAutoTranslate, setCaptionAutoTranslate] = useState<boolean>(false);
    const [captionShowForAll, setCaptionShowForAll] = useState<boolean>(false);
    const [captionsEnabled, setCaptionsEnabled] = useState<boolean>(true);
    const captionSettingsRef = useRef({
        autoTranslate: captionAutoTranslate,
        targetLanguage: captionTargetLanguage,
        showForAll: captionShowForAll,
    });
    const broadcastedChunksRef = useRef<Set<string>>(new Set());

    const isGroupCall = Boolean(participants && participants.length > 0);
    const stageSpeakers = useMemo(
        () => (participants ?? []).filter(p => p.role !== 'listener' && p.role !== 'requesting_speak'),
        [participants],
    );
    const listenerParticipants = useMemo(
        () => (participants ?? []).filter(p => p.role === 'listener' || p.role === 'requesting_speak'),
        [participants],
    );
    const queueOrder = stageState?.handRaiseQueue ?? [];
    const callIdentifier = useMemo(() => {
        if (callSession?.callId) return callSession.callId;
        if (coordinator) return coordinator.sessionId;
        const directId = (call as any)?.callId ?? (call as any)?.groupCallId;
        return typeof directId === 'string' ? directId : null;
    }, [callSession?.callId, coordinator, call]);
    const latestCaption = useMemo(() => {
        for (let idx = captionOrder.length - 1; idx >= 0; idx -= 1) {
            const chunk = liveCaptions[captionOrder[idx]];
            if (chunk && (chunk.final || chunk.text)) {
                return chunk;
            }
        }
        return null;
    }, [captionOrder, liveCaptions]);

    useEffect(() => {
        captionSettingsRef.current = {
            autoTranslate: captionAutoTranslate,
            targetLanguage: captionTargetLanguage,
            showForAll: captionShowForAll,
        };
    }, [captionAutoTranslate, captionTargetLanguage, captionShowForAll]);

    useEffect(() => {
        if (callSession) return;
        const runtime = getTranscriptionRuntimeConfig();
        if (!captionTargetLanguage && runtime.defaultTargetLanguage) {
            setCaptionTargetLanguage(runtime.defaultTargetLanguage);
        }
        if (captionLanguage === 'auto' && runtime.defaultLanguage) {
            setCaptionLanguage(runtime.defaultLanguage);
        }
    }, [callSession, captionLanguage, captionTargetLanguage]);

    useEffect(() => {
        if (!callSession) {
            return;
        }
        const deviceId = localDeviceId ?? client.getDeviceId?.() ?? null;
        const device = deviceId ? callSession.devices.find(d => d.deviceId === deviceId) : null;
        const prefs = device?.captionPreferences;
        if (prefs) {
            if (typeof prefs.language === 'string') {
                setCaptionLanguage(prefs.language || 'auto');
            }
            if (typeof prefs.targetLanguage === 'string') {
                setCaptionTargetLanguage(prefs.targetLanguage);
            }
            setCaptionAutoTranslate(prefs.autoTranslate === true);
            setCaptionShowForAll(prefs.showForAll === true);
        }
    }, [callSession, localDeviceId, client]);

    useEffect(() => {
        if (!callIdentifier) return;
        const unsubscribe = subscribeLiveTranscription(callIdentifier, chunk => {
            setLiveCaptions(prev => ({
                ...prev,
                [chunk.chunkId]: {
                    ...(prev[chunk.chunkId] ?? {}),
                    ...chunk,
                },
            }));
            setCaptionOrder(prev => (prev.includes(chunk.chunkId) ? prev : [...prev, chunk.chunkId]));
            if (chunk.final && chunk.source === 'local' && coordinator && captionSettingsRef.current.showForAll) {
                if (!broadcastedChunksRef.current.has(chunk.chunkId)) {
                    coordinator.publishCaption(chunk.text, {
                        id: chunk.chunkId,
                        language: chunk.language,
                        final: chunk.final,
                        translatedText: chunk.translatedText,
                        targetLanguage: chunk.targetLanguage,
                    });
                    broadcastedChunksRef.current.add(chunk.chunkId);
                }
            }
            if (chunk.final) {
                const settings = captionSettingsRef.current;
                if (
                    settings.autoTranslate &&
                    typeof settings.targetLanguage === 'string' &&
                    settings.targetLanguage.trim().length > 0 &&
                    !chunk.translatedText
                ) {
                    const target = settings.targetLanguage.trim();
                    void translateCaption(callIdentifier, chunk.text, target, chunk.language)
                        .then(result => {
                            if (!result) return;
                            setLiveCaptions(current => {
                                const existing = current[chunk.chunkId];
                                if (!existing) return current;
                                return {
                                    ...current,
                                    [chunk.chunkId]: {
                                        ...existing,
                                        translatedText: result,
                                        targetLanguage: target,
                                    },
                                };
                            });
                            if (settings.showForAll && coordinator) {
                                const key = `${chunk.chunkId}:tl:${target}`;
                                if (!broadcastedChunksRef.current.has(key)) {
                                    coordinator.publishCaptionTranslation(chunk.chunkId, result, target);
                                    broadcastedChunksRef.current.add(key);
                                }
                            }
                        })
                        .catch(error => console.warn('Failed to translate caption', error));
                }
            }
        });
        return unsubscribe;
    }, [callIdentifier, coordinator]);

    useEffect(() => {
        if (!coordinator || !callIdentifier) return;
        if (!(captionsEnabled || captionShowForAll || captionAutoTranslate)) {
            return;
        }
        const stream = coordinator.getLocalStream();
        if (!stream) {
            return;
        }
        const session = startLiveTranscriptionSession(stream, {
            callId: callIdentifier,
            language: captionLanguage === 'auto' ? undefined : captionLanguage,
        });
        return () => {
            if (session) {
                stopLiveTranscriptionSession(callIdentifier);
            }
        };
    }, [coordinator, callIdentifier, captionLanguage, captionsEnabled, captionShowForAll, captionAutoTranslate]);

    const persistCaptionPreferences = (
        next: {
            language?: string;
            targetLanguage?: string;
            autoTranslate?: boolean;
            showForAll?: boolean;
        },
    ) => {
        const effective = {
            language: next.language ?? captionLanguage,
            targetLanguage: next.targetLanguage ?? captionTargetLanguage,
            autoTranslate: next.autoTranslate ?? captionAutoTranslate,
            showForAll: next.showForAll ?? captionShowForAll,
        };
        updateLocalCallDeviceState(client, {
            captionPreferences: {
                language: effective.language === 'auto' ? undefined : effective.language,
                targetLanguage: effective.targetLanguage?.trim() || undefined,
                autoTranslate: effective.autoTranslate,
                showForAll: effective.showForAll,
            },
        });
    };

    const handleCaptionLanguageChange = (value: string) => {
        setCaptionLanguage(value);
        persistCaptionPreferences({ language: value });
    };

    const handleCaptionTargetChange = (value: string) => {
        setCaptionTargetLanguage(value);
        persistCaptionPreferences({ targetLanguage: value });
    };

    const handleCaptionAutoTranslateChange = (enabled: boolean) => {
        setCaptionAutoTranslate(enabled);
        persistCaptionPreferences({ autoTranslate: enabled });
    };

    const handleCaptionShowForAllChange = (enabled: boolean) => {
        setCaptionShowForAll(enabled);
        persistCaptionPreferences({ showForAll: enabled });
    };

    useEffect(() => {
        if (!call || isGroupCall) return;
        if (localVideoRef.current) {
            (call as any).setLocalVideoElement(localVideoRef.current);
        }
        if (remoteVideoRef.current) {
            (call as any).setRemoteVideoElement(remoteVideoRef.current);
        }
    }, [call, isGroupCall]);

    useEffect(() => {
        if (!call || isGroupCall) return;
        const onStateChanged = (newState: string) => {
            setCallState(newState);
            if (newState === 'connected') {
                if (durationIntervalRef.current) {
                    window.clearInterval(durationIntervalRef.current);
                }
                durationIntervalRef.current = window.setInterval(() => {
                    setDuration(prev => prev + 1);
                }, 1000);
            } else if (durationIntervalRef.current) {
                window.clearInterval(durationIntervalRef.current);
                durationIntervalRef.current = null;
            }
        };

        call.on(CallEvent.State, onStateChanged as any);
        if (call.state === 'connected') {
            onStateChanged('connected');
        }

        return () => {
            call.removeListener(CallEvent.State, onStateChanged as any);
            if (durationIntervalRef.current) {
                window.clearInterval(durationIntervalRef.current);
                durationIntervalRef.current = null;
            }
        };
    }, [call, isGroupCall]);

    useEffect(() => {
        if (typeof mutedProp === 'boolean') {
            setInternalMuted(mutedProp);
        }
    }, [mutedProp]);

    useEffect(() => {
        if (typeof videoMutedProp === 'boolean') {
            setInternalVideoMuted(videoMutedProp);
        }
    }, [videoMutedProp]);

    useEffect(() => {
        if (!call || isGroupCall || !callSession || !localDeviceId) {
            return;
        }
        const localDevice = callSession.devices.find(device => device.deviceId === localDeviceId);
        if (!localDevice) {
            return;
        }
        const isCurrentlyMuted = typeof (call as any).isMicrophoneMuted === 'function'
            ? Boolean((call as any).isMicrophoneMuted())
            : internalMuted;
        const shouldBeActive = callSession.activeDeviceId === localDeviceId;

        if (!shouldBeActive && (!localDevice.muted || !isCurrentlyMuted)) {
            try {
                if (typeof (call as any).setMicrophoneMuted === 'function') {
                    (call as any).setMicrophoneMuted(true);
                } else if (typeof call.setLocalMute === 'function') {
                    call.setLocalMute(true);
                }
            } catch (error) {
                console.warn('Failed to mute local call after handover', error);
            }
            updateLocalCallDeviceState(client, { muted: true, connected: false });
        } else if (shouldBeActive && localDevice.muted && isCurrentlyMuted) {
            try {
                if (typeof (call as any).setMicrophoneMuted === 'function') {
                    (call as any).setMicrophoneMuted(false);
                } else if (typeof call.setLocalMute === 'function') {
                    call.setLocalMute(false);
                }
            } catch (error) {
                console.warn('Failed to unmute local call after handover', error);
            }
            updateLocalCallDeviceState(client, { muted: false, connected: true });
        } else if (shouldBeActive && localDevice.connected !== true) {
            updateLocalCallDeviceState(client, { connected: true });
        }
    }, [call, client, callSession, localDeviceId, isGroupCall, internalMuted]);

    const computedMuted = typeof mutedProp === 'boolean' ? mutedProp : internalMuted;
    const computedVideoMuted = typeof videoMutedProp === 'boolean' ? videoMutedProp : internalVideoMuted;

    const toggleMute = () => {
        if (onToggleLocalMute) {
            onToggleLocalMute();
        } else if (call) {
            const newState = !computedMuted;
            call.setMicrophoneMuted(newState);
            setInternalMuted(newState);
        }
    };

    const toggleVideoMute = () => {
        if (onToggleLocalVideo) {
            onToggleLocalVideo();
        } else if (call) {
            const newState = !computedVideoMuted;
            (call as any).setVideoMuted(newState);
            setInternalVideoMuted(newState);
        }
    };

    const getStateText = () => {
        if (isGroupCall) {
            return 'Групповой звонок';
        }
        switch (callState) {
            case 'connecting':
                return 'Connecting...';
            case 'ringing':
                return 'Ringing...';
            case 'connected':
                return formatDuration(duration);
            default:
                return callState ? callState.charAt(0).toUpperCase() + callState.slice(1) : 'Звонок';
        }
    };

    const participantTiles = useMemo<VideoTileInfo[]>(() => {
        if (stageSpeakers.length === 0) return [];
        return stageSpeakers.flatMap(participant => {
            const tiles: VideoTileInfo[] = [
                {
                    id: participant.id,
                    baseId: participant.id,
                    name: participant.name,
                    mediaStream: participant.stream ?? null,
                    isLocal: participant.isLocal,
                    isMuted: participant.isMuted,
                    isVideoMuted: participant.isVideoMuted,
                    avatarUrl: participant.avatarUrl ?? null,
                },
            ];
            if (participant.screenshareStream) {
                tiles.push({
                    id: `${participant.id}-screen`,
                    baseId: participant.id,
                    name: `${participant.name} — экран`,
                    mediaStream: participant.screenshareStream,
                    isLocal: participant.isLocal,
                    isMuted: true,
                    isVideoMuted: false,
                    isScreenShare: true,
                    avatarUrl: participant.avatarUrl ?? null,
                });
            }
            return tiles;
        });
    }, [stageSpeakers]);

    const dominantId = useMemo(() => stageSpeakers.find(p => p.dominant)?.id, [stageSpeakers]);
    const spotlightTile = layout === 'spotlight'
        ? participantTiles.find(tile => tile.baseId === dominantId) ?? participantTiles[0] ?? null
        : null;
    const secondaryTiles = layout === 'spotlight' && spotlightTile
        ? participantTiles.filter(tile => tile.id !== spotlightTile.id)
        : participantTiles;

    if (isGroupCall) {
        const localParticipant = participants?.find(p => p.isLocal);
        const localParticipantId = localParticipant?.id ?? localUserId ?? '';
        const localRole = localParticipant?.role ?? 'participant';
        const canRaise = Boolean(onRaiseHand) && localRole === 'listener';
        const canLower = Boolean(onLowerHand) && localRole === 'requesting_speak';
        const canStepDown = Boolean(onSendParticipantToAudience) && localParticipantId && !['listener', 'requesting_speak'].includes(localRole ?? '');
        const getParticipantByTile = (tile: VideoTileInfo) => stageSpeakers.find(p => p.id === tile.baseId);
        return (
            <div className="fixed inset-0 bg-gray-900/95 z-40 flex flex-col">
                <div className="absolute top-6 left-6 flex items-center gap-3">
                    <button
                        className={`px-3 py-1 rounded-full text-sm ${layout === 'grid' ? 'bg-indigo-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary'}`}
                        onClick={() => onLayoutChange?.('grid')}
                        type="button"
                    >
                        Сетка
                    </button>
                    <button
                        className={`px-3 py-1 rounded-full text-sm ${layout === 'spotlight' ? 'bg-indigo-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary'}`}
                        onClick={() => onLayoutChange?.('spotlight')}
                        type="button"
                    >
                        Фокус
                    </button>
                    {onToggleScreenshare && (
                        <button
                            className={`px-3 py-1 rounded-full text-sm ${isScreensharing ? 'bg-emerald-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary'}`}
                            onClick={onToggleScreenshare}
                            type="button"
                        >
                            {isScreensharing ? 'Остановить экран' : 'Поделиться экраном'}
                        </button>
                    )}
                    {onToggleCoWatch && (
                        <button
                            className={`px-3 py-1 rounded-full text-sm ${coWatchActive ? 'bg-purple-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary'}`}
                            onClick={onToggleCoWatch}
                            type="button"
                        >
                            {coWatchActive ? 'Завершить просмотр' : 'Совместный просмотр'}
                        </button>
                    )}
                </div>

                <div className="absolute top-6 right-6 flex items-center gap-3">
                    <div className="text-sm text-text-secondary">{headerTitle || 'Групповой звонок'}</div>
                    <button
                        className={`px-3 py-1 rounded-full text-sm ${captionsEnabled ? 'bg-indigo-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary'}`}
                        onClick={() => setCaptionsEnabled(prev => !prev)}
                        type="button"
                    >
                        {captionsEnabled ? 'CC вкл.' : 'CC выкл.'}
                    </button>
                    <button
                        className="px-3 py-1 rounded-full text-sm bg-bg-secondary hover:bg-bg-tertiary"
                        onClick={onToggleParticipantsPanel}
                        type="button"
                    >
                        👥 {participants?.length ?? 0}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto pt-20 pb-36">
                    {layout === 'spotlight' && spotlightTile && (
                        <div className="max-w-5xl mx-auto px-6">
                            <div className="relative">
                                <VideoTile tile={spotlightTile} localMuted={computedMuted} />
                                {canModerateParticipants && onSendParticipantToAudience && (() => {
                                    const spotlightParticipant = getParticipantByTile(spotlightTile);
                                    if (!spotlightParticipant || spotlightParticipant.isLocal || !spotlightParticipant.role || ['host', 'moderator'].includes(spotlightParticipant.role)) {
                                        return null;
                                    }
                                    return (
                                        <button
                                            type="button"
                                            className="absolute top-3 right-3 rounded-full bg-black/60 hover:bg-black/80 px-3 py-1 text-xs text-white"
                                            onClick={() => onSendParticipantToAudience(spotlightParticipant.id)}
                                        >
                                            В зрители
                                        </button>
                                    );
                                })()}
                            </div>
                        </div>
                    )}
                    <div className="mt-6 px-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {secondaryTiles.map(tile => {
                            const tileParticipant = getParticipantByTile(tile);
                            const canDemote =
                                canModerateParticipants &&
                                onSendParticipantToAudience &&
                                tileParticipant &&
                                !tileParticipant.isLocal &&
                                tileParticipant.role &&
                                !['host', 'moderator'].includes(tileParticipant.role);
                            return (
                                <div key={tile.id} className="relative">
                                    <VideoTile tile={tile} localMuted={computedMuted} compact={layout === 'spotlight'} />
                                    {canDemote && (
                                        <button
                                            type="button"
                                            className="absolute top-3 right-3 rounded-full bg-black/60 hover:bg-black/80 px-3 py-1 text-xs text-white"
                                            onClick={() => onSendParticipantToAudience(tileParticipant.id)}
                                        >
                                            В зрители
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {listenerParticipants.length > 0 && (
                        <div className="mt-10 px-6">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-xs uppercase tracking-wide text-text-secondary">Зрители</h3>
                                {queueOrder.length > 0 && (
                                    <span className="text-xs text-text-secondary">Очередь рук: {queueOrder.length}</span>
                                )}
                            </div>
                            <div className="flex gap-3 overflow-x-auto pb-4">
                                {listenerParticipants.map(listener => {
                                    const queuePos = queueOrder.indexOf(listener.id);
                                    return (
                                        <div
                                            key={listener.id}
                                            className={`min-w-[180px] rounded-xl border ${listener.role === 'requesting_speak' ? 'border-amber-400/80 bg-amber-500/10' : 'border-transparent bg-bg-secondary/70'} p-3`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium truncate">{listener.name}</span>
                                                <span>{listener.role === 'requesting_speak' ? `✋${queuePos >= 0 ? ` #${queuePos + 1}` : ''}` : '👀'}</span>
                                            </div>
                                            <div className="mt-1 text-[11px] text-text-secondary flex items-center gap-2">
                                                <span>{listener.isMuted ? '🔇' : '🎙️'}</span>
                                                <span>{listener.isVideoMuted ? '📷 выкл.' : '📷 вкл.'}</span>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {listener.role === 'requesting_speak' && onLowerHand && (
                                                    <button
                                                        type="button"
                                                        className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-secondary"
                                                        onClick={() => onLowerHand(listener.id)}
                                                    >
                                                        Опустить руку
                                                    </button>
                                                )}
                                                {canModerateParticipants && onBringParticipantToStage && (
                                                    <button
                                                        type="button"
                                                        className="text-xs px-2 py-1 rounded bg-indigo-600/90 text-white hover:bg-indigo-500"
                                                        onClick={() => onBringParticipantToStage(listener.id)}
                                                    >
                                                        Вывести на сцену
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {captionsEnabled && latestCaption && (
                    <div className="absolute bottom-36 inset-x-0 flex justify-center pointer-events-none px-6">
                        <div className="max-w-3xl bg-black/70 text-white px-4 py-3 rounded-2xl text-center text-base shadow-lg">
                            <div className="font-medium break-words">{latestCaption.translatedText ?? latestCaption.text}</div>
                            <div className="text-xs text-white/70 mt-1">
                                {(latestCaption.language || 'auto').toUpperCase()}
                                {latestCaption.translatedText
                                    ? ` → ${(latestCaption.targetLanguage || captionTargetLanguage || '').toUpperCase()}`
                                    : ''}
                            </div>
                        </div>
                    </div>
                )}

                <div className="absolute bottom-12 inset-x-0 flex flex-wrap items-center justify-center gap-4">
                    {canRaise && (
                        <button
                            onClick={onRaiseHand}
                            className="px-4 py-2 rounded-full bg-amber-500/90 hover:bg-amber-500 text-white text-sm"
                            type="button"
                        >
                            ✋ Поднять руку
                        </button>
                    )}
                    {canLower && (
                        <button
                            onClick={() => onLowerHand?.()}
                            className="px-4 py-2 rounded-full bg-amber-600/90 hover:bg-amber-600 text-white text-sm"
                            type="button"
                        >
                            ✋ Опустить руку
                        </button>
                    )}
                    {canStepDown && (
                        <button
                            onClick={() => localParticipantId && onSendParticipantToAudience?.(localParticipantId)}
                            className="px-4 py-2 rounded-full bg-bg-secondary hover:bg-bg-tertiary text-text-primary text-sm"
                            type="button"
                        >
                            ⬇️ В зрители
                        </button>
                    )}
                    <button
                        onClick={toggleMute}
                        className={`h-14 w-14 rounded-full flex items-center justify-center transition-colors ${computedMuted ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}
                        title={computedMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                        type="button"
                    >
                        {computedMuted ? '🔇' : '🎙️'}
                    </button>
                    <button
                        onClick={toggleVideoMute}
                        className={`h-14 w-14 rounded-full flex items-center justify-center transition-colors ${computedVideoMuted ? 'bg-indigo-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}
                        title={computedVideoMuted ? 'Включить камеру' : 'Выключить камеру'}
                        type="button"
                    >
                        {computedVideoMuted ? '📷🚫' : '📷'}
                    </button>
                    <button
                        onClick={onHangup}
                        className="h-16 w-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white text-xl"
                        title="Завершить звонок"
                        type="button"
                    >
                        ☎️
                    </button>
                </div>

                {effectsPanelOpen && (
                    <div
                        className={`fixed ${showParticipantsPanel ? 'right-[22rem]' : 'right-4'} top-24 bottom-4 w-80 bg-bg-secondary border border-border-primary rounded-xl shadow-xl p-4 z-50 overflow-y-auto`}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-text-primary">Эффекты камеры</h3>
                            <button
                                type="button"
                                className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-secondary text-text-secondary"
                                onClick={() => setEffectsPanelOpen(false)}
                            >
                                Закрыть
                            </button>
                        </div>
                        <div className="aspect-video rounded-lg overflow-hidden bg-black/80 mb-4">
                            <video
                                ref={effectsPreviewRef}
                                muted
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <div className="space-y-4 text-sm text-text-primary">
                            <div>
                                <label className="block text-xs text-text-secondary mb-1" htmlFor="call-effects-preset">
                                    Пресет
                                </label>
                                <select
                                    id="call-effects-preset"
                                    value={localEffectsState?.presetId ?? ''}
                                    onChange={event => handlePresetSelect(event.target.value)}
                                    className="w-full rounded-md border border-border-primary bg-bg-tertiary px-2 py-1 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring-focus"
                                    disabled={!onLocalEffectsChange}
                                >
                                    <option value="">Своя настройка</option>
                                    {presets.map(preset => (
                                        <option key={preset.id} value={preset.id}>
                                            {preset.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <span className="block text-xs text-text-secondary mb-1">Фон</span>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className={`px-2 py-1 rounded text-xs ${
                                            backgroundMode === 'none'
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-bg-tertiary hover:bg-bg-secondary text-text-secondary'
                                        }`}
                                        onClick={() => handleBackgroundMode('none')}
                                        disabled={!onLocalEffectsChange}
                                    >
                                        Обычный
                                    </button>
                                    <button
                                        type="button"
                                        className={`px-2 py-1 rounded text-xs ${
                                            backgroundMode === 'gradient'
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-bg-tertiary hover:bg-bg-secondary text-text-secondary'
                                        }`}
                                        onClick={() => handleBackgroundMode('gradient')}
                                        disabled={!onLocalEffectsChange}
                                    >
                                        Градиент
                                    </button>
                                    <button
                                        type="button"
                                        className="px-2 py-1 rounded text-xs bg-bg-tertiary hover:bg-bg-secondary text-text-secondary"
                                        onClick={() => backgroundFileInputRef.current?.click()}
                                        disabled={!onLocalEffectsChange}
                                    >
                                        Из файла…
                                    </button>
                                    <input
                                        type="file"
                                        ref={backgroundFileInputRef}
                                        accept="image/*"
                                        onChange={handleBackgroundUpload}
                                        className="hidden"
                                    />
                                </div>
                                {backgroundEffect?.assetUrl && (
                                    <p className="mt-1 text-xs text-text-secondary break-words">
                                        Используется пользовательское изображение.
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs text-text-secondary mb-1" htmlFor="call-effects-blur">
                                    Размытие ({Math.round(blurIntensity)} px)
                                </label>
                                <input
                                    id="call-effects-blur"
                                    type="range"
                                    min={0}
                                    max={15}
                                    step={1}
                                    value={Math.round(blurIntensity)}
                                    onChange={event => handleBlurIntensity(Number(event.target.value))}
                                    className="w-full"
                                    disabled={!onLocalEffectsChange}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-text-secondary mb-1" htmlFor="call-effects-noise">
                                    Шумоподавление ({Math.round(noiseLevel * 100)}%)
                                </label>
                                <input
                                    id="call-effects-noise"
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    value={Number(noiseLevel.toFixed(1))}
                                    onChange={event => handleNoiseLevel(Number(event.target.value))}
                                    className="w-full"
                                    disabled={!onLocalEffectsChange}
                                />
                            </div>
                            <label className="flex items-center gap-2 text-xs text-text-primary">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 text-accent focus:ring-ring-focus"
                                    checked={applyEffectsToRemote}
                                    onChange={event => handleApplyEffectsToRemote(event.target.checked)}
                                    disabled={!onLocalEffectsChange}
                                />
                                Применять к входящему видео
                            </label>
                            <button
                                type="button"
                                className="w-full px-3 py-2 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={() => void handleSavePreset()}
                                disabled={!onSaveEffectsPreset || !onLocalEffectsChange}
                            >
                                Сохранить как пресет
                            </button>
                        </div>
                    </div>
                )}

                {showParticipantsPanel && (
                    <CallParticipantsPanel
                        participants={participants ?? []}
                        onClose={onToggleParticipantsPanel}
                        onMuteToggle={onMuteParticipant}
                        onVideoToggle={onVideoParticipantToggle}
                        onRemoveParticipant={onRemoveParticipant}
                        onPromotePresenter={onPromotePresenter}
                        onSpotlight={onSpotlightParticipant}
                        onBringToStage={onBringParticipantToStage}
                        onSendToAudience={onSendParticipantToAudience}
                        onLowerHand={id => onLowerHand?.(id)}
                        localUserId={localUserId}
                        canModerate={canModerateParticipants}
                        captionLanguage={captionLanguage}
                        captionTargetLanguage={captionTargetLanguage}
                        captionAutoTranslate={captionAutoTranslate}
                        captionShowForAll={captionShowForAll}
                        onCaptionLanguageChange={handleCaptionLanguageChange}
                        onCaptionTargetLanguageChange={handleCaptionTargetChange}
                        onCaptionAutoTranslateChange={handleCaptionAutoTranslateChange}
                        onCaptionShowForAllChange={handleCaptionShowForAllChange}
                    />
                )}
            </div>
        );
    }

    // Fallback to classic one-to-one call UI
    const peerMember = call ? (call as any).getPeerMember() : null;
    const peerName = peerMember?.name || 'Unknown User';
    const peerAvatar = mxcToHttp(client, peerMember?.getMxcAvatarUrl?.(), 128);
    const isVideoCall = call?.type === 'video';
    const secondaryParticipants = callSession
        ? callSession.devices.filter(device => device.deviceId !== callSession.activeDeviceId)
        : [];
    const handoverEnabled = Boolean(
        callSession &&
        onHandover &&
        localDeviceId &&
        callSession.activeDeviceId &&
        callSession.activeDeviceId !== localDeviceId,
    );
    const localCallDevice = callSession?.devices.find(device => device.deviceId === localDeviceId);

    return (
        <div className="fixed inset-0 bg-gray-900/95 z-40 flex flex-col items-center justify-center animate-fade-in-fast">
            {isVideoCall && (
                <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="absolute top-0 left-0 w-full h-full object-cover"
                />
            )}

            <div className="absolute top-6 right-6 flex items-center gap-3 z-10">
                <button
                    className={`px-3 py-1 rounded-full text-sm ${captionsEnabled ? 'bg-indigo-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary'}`}
                    onClick={() => setCaptionsEnabled(prev => !prev)}
                    type="button"
                >
                    {captionsEnabled ? 'CC вкл.' : 'CC выкл.'}
                </button>
            </div>

            <div className="relative text-center z-10">
                {!isVideoCall && <Avatar name={peerName} imageUrl={peerAvatar} size="md" />}
                <h2 className="text-3xl font-bold mt-4 text-shadow">{peerName}</h2>
                <p className="text-gray-300 text-lg mt-2 text-shadow">{getStateText()}</p>
            </div>

            {callSession && (
                <div className="absolute top-20 inset-x-0 flex justify-center z-10 px-4">
                    <div className="flex flex-wrap items-center gap-3 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-xs text-white max-w-3xl">
                        <span>
                            {callSession.activeDeviceId && callSession.activeDeviceId === localDeviceId
                                ? 'Звонок активен на этом устройстве'
                                : 'Звонок активен на другом устройстве'}
                        </span>
                        {secondaryParticipants.length > 0 && (
                            <span className="text-white/70 truncate">
                                Вторичные устройства: {secondaryParticipants
                                    .map(device => device.label || device.userId || device.deviceId)
                                    .filter(Boolean)
                                    .join(', ')}
                            </span>
                        )}
                        {localCallDevice && localCallDevice.muted && callSession.activeDeviceId !== localDeviceId && (
                            <span className="text-amber-300/80">Микрофон этого устройства отключён</span>
                        )}
                        {handoverEnabled && (
                            <button
                                type="button"
                                onClick={onHandover}
                                className="px-3 py-1 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white font-medium"
                            >
                                Подхватить на этом устройстве
                            </button>
                        )}
                    </div>
                </div>
            )}

            {isVideoCall && (
                <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`absolute bottom-40 right-8 w-48 h-auto rounded-lg shadow-lg border-2 border-gray-700 transition-opacity ${computedVideoMuted ? 'opacity-0' : 'opacity-100'}`}
                />
            )}

            {captionsEnabled && latestCaption && (
                <div className="absolute bottom-28 inset-x-0 flex justify-center pointer-events-none px-6 z-10">
                    <div className="max-w-2xl bg-black/70 text-white px-4 py-3 rounded-2xl text-center text-base shadow-lg">
                        <div className="font-medium break-words">{latestCaption.translatedText ?? latestCaption.text}</div>
                        <div className="text-xs text-white/70 mt-1">
                            {(latestCaption.language || 'auto').toUpperCase()}
                            {latestCaption.translatedText
                                ? ` → ${(latestCaption.targetLanguage || captionTargetLanguage || '').toUpperCase()}`
                                : ''}
                        </div>
                    </div>
                </div>
            )}

            <div className="absolute bottom-16 flex items-center gap-8 z-10">
                <button
                    onClick={onToggleScreenshare}
                    className="h-16 w-16 rounded-full flex items-center justify-center bg-gray-700 hover:bg-gray-600"
                    title="Экран"
                    type="button"
                >
                    🖥️
                </button>
                <button
                    onClick={toggleMute}
                    className={`h-16 w-16 rounded-full flex items-center justify-center transition-colors ${computedMuted ? 'bg-indigo-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}
                    title={computedMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                    type="button"
                >
                    {computedMuted ? '🔇' : '🎙️'}
                </button>
                {isVideoCall && (
                    <button
                        onClick={toggleVideoMute}
                        className={`h-16 w-16 rounded-full flex items-center justify-center transition-colors ${computedVideoMuted ? 'bg-indigo-500 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}
                        title={computedVideoMuted ? 'Включить камеру' : 'Выключить камеру'}
                        type="button"
                    >
                        {computedVideoMuted ? '📷🚫' : '📷'}
                    </button>
                )}
                <button
                    onClick={onHangup}
                    className="h-20 w-20 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center"
                    title="End call"
                    type="button"
                >
                    ☎️
                </button>
            </div>
        </div>
    );
};

export default CallView;

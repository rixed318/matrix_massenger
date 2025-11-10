import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MatrixCall, MatrixClient, CallSessionState, updateLocalCallDeviceState } from '@matrix-messenger/core';
import Avatar from './Avatar';
import { mxcToHttp } from '@matrix-messenger/core';
import { CallEvent } from 'matrix-js-sdk';
import CallParticipantsPanel, { Participant as CallParticipant } from './CallParticipantsPanel';
import { GroupCallStageState } from '../services/webrtc/groupCallConstants';

export type CallLayout = 'spotlight' | 'grid';

interface ExtendedParticipant extends CallParticipant {
    stream?: MediaStream | null;
    screenshareStream?: MediaStream | null;
    dominant?: boolean;
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
}) => {
    const [callState, setCallState] = useState<string>(call?.state ?? '');
    const [duration, setDuration] = useState(0);
    const [internalMuted, setInternalMuted] = useState(call?.isMicrophoneMuted() ?? false);
    const [internalVideoMuted, setInternalVideoMuted] = useState(call?.isLocalVideoMuted() ?? false);
    const durationIntervalRef = useRef<number | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

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

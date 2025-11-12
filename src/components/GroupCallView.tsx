import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CallParticipantsPanel, { Participant } from './CallParticipantsPanel';
import { GroupCallStageState } from '../services/webrtc/groupCallConstants';

export interface GroupCallSessionMetadata {
    scheduledStartAt?: number | null;
    lobbyMode?: 'closed' | 'open' | 'scheduled';
    lobbyEnabled?: boolean;
    isPersistentRoom?: boolean;
    livestreamEnabled?: boolean;
    handRaiseQueue?: string[];
    lastUpdatedAt?: number;
}

export interface GroupCallState {
    roomId: string;
    url: string;
    participants: Participant[];
    layout: 'grid' | 'spotlight';
    isScreensharing: boolean;
    metadata?: GroupCallSessionMetadata;
    stage?: GroupCallStageState | null;
}

interface Props {
    state: GroupCallState;
    onClose: () => void;
    onParticipantsUpdate: (list: Participant[]) => void;
    onToggleScreenshare: () => void;
    onLayoutChange: (layout: 'grid' | 'spotlight') => void;
    onStageChange?: (stage: GroupCallStageState | null) => void;
    onPersistLayout?: (layout: 'grid' | 'spotlight') => void;
    onPersistStageState?: (stage: GroupCallStageState | null) => void;
    showParticipants: boolean;
    onHideParticipants: () => void;
    onScheduleSession?: (timestamp: number | null) => void;
    onStartSession?: () => void;
    onStopSession?: () => void;
    onToggleLobby?: (enabled: boolean) => void;
    onTogglePersistentRoom?: (enabled: boolean) => void;
    onOpenLobby?: () => void;
    onConvertToLivestream?: () => void;
    onLowerHand?: (participantId: string) => void;
    onBringToStage?: (participantId: string) => void;
    onSendToAudience?: (participantId: string) => void;
}

/**
 * Generic group call container that embeds an SFU page via iframe.
 * Communicates via postMessage and bridges call metadata and stage controls.
 */
const GroupCallView: React.FC<Props> = ({
    state,
    onClose,
    onParticipantsUpdate,
    onToggleScreenshare,
    onLayoutChange,
    onStageChange,
    onPersistLayout,
    onPersistStageState,
    showParticipants,
    onHideParticipants,
    onScheduleSession,
    onStartSession,
    onStopSession,
    onToggleLobby,
    onTogglePersistentRoom,
    onOpenLobby,
    onConvertToLivestream,
    onLowerHand,
    onBringToStage,
    onSendToAudience,
}) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [sessionMetadata, setSessionMetadata] = useState<GroupCallSessionMetadata>(state.metadata ?? {});
    const [stageState, setStageState] = useState<GroupCallStageState | null>(state.stage ?? null);
    const [handRaiseQueue, setHandRaiseQueue] = useState<string[]>(() =>
        state.metadata?.handRaiseQueue ? [...state.metadata.handRaiseQueue] : []
    );
    const [showStagePanel, setShowStagePanel] = useState(false);
    const [showMetadataPanel, setShowMetadataPanel] = useState(false);

    useEffect(() => {
        setSessionMetadata(state.metadata ?? {});
    }, [state.metadata]);

    useEffect(() => {
        setStageState(state.stage ?? null);
    }, [state.stage]);

    useEffect(() => {
        if (Array.isArray(state.metadata?.handRaiseQueue)) {
            setHandRaiseQueue([...state.metadata.handRaiseQueue]);
        }
    }, [state.metadata?.handRaiseQueue]);

    useEffect(() => {
        const handler = (ev: MessageEvent) => {
            if (!ev?.data || typeof ev.data !== 'object') return;
            if (ev.data.type === 'participants-update' && Array.isArray(ev.data.participants)) {
                onParticipantsUpdate(ev.data.participants);
            }
            if (ev.data.type === 'layout-changed' && (ev.data.layout === 'grid' || ev.data.layout === 'spotlight')) {
                onLayoutChange(ev.data.layout);
                onPersistLayout?.(ev.data.layout);
            }
            if (ev.data.type === 'session-metadata') {
                const metadata: GroupCallSessionMetadata = {
                    scheduledStartAt: ev.data.scheduledStartAt ?? null,
                    lobbyMode: ev.data.lobbyMode ?? 'closed',
                    lobbyEnabled: ev.data.lobbyEnabled ?? false,
                    isPersistentRoom: ev.data.isPersistentRoom ?? false,
                    livestreamEnabled: ev.data.livestreamEnabled ?? false,
                    handRaiseQueue: Array.isArray(ev.data.handRaiseQueue) ? [...ev.data.handRaiseQueue] : [],
                    lastUpdatedAt: typeof ev.data.lastUpdatedAt === 'number' ? ev.data.lastUpdatedAt : Date.now(),
                };
                setSessionMetadata(metadata);
                setHandRaiseQueue(metadata.handRaiseQueue ?? []);
            }
            if (ev.data.type === 'hand-raise') {
                setHandRaiseQueue(queue => {
                    const next = new Set(queue ?? []);
                    if (typeof ev.data.userId === 'string') {
                        next.add(ev.data.userId);
                    }
                    return Array.from(next);
                });
            }
            if (ev.data.type === 'hand-lower') {
                if (typeof ev.data.userId === 'string') {
                    setHandRaiseQueue(queue => (queue ?? []).filter(id => id !== ev.data.userId));
                    onLowerHand?.(ev.data.userId);
                }
            }
            if (ev.data.type === 'stage-changed' && ev.data.stage) {
                const stage = ev.data.stage as GroupCallStageState;
                setStageState(stage);
                onStageChange?.(stage);
                onPersistStageState?.(stage);
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [onParticipantsUpdate, onLayoutChange, onPersistLayout, onLowerHand, onStageChange, onPersistStageState]);

    const postToIframe = useCallback((msg: any) => {
        const win = iframeRef.current?.contentWindow;
        if (win) {
            win.postMessage(msg, '*');
        }
    }, []);

    const toggleScreenShare = () => {
        postToIframe({ type: 'toggle-screen-share' });
        onToggleScreenshare();
    };

    const requestLayout = (layout: 'grid' | 'spotlight') => {
        postToIframe({ type: 'set-layout', layout });
        onLayoutChange(layout);
        onPersistLayout?.(layout);
    };

    const toggleLobby = () => {
        const enabled = !sessionMetadata?.lobbyEnabled;
        onToggleLobby?.(enabled);
        postToIframe({ type: 'toggle-lobby', enabled });
        setSessionMetadata(prev => ({ ...prev, lobbyEnabled: enabled }));
    };

    const togglePersistentRoom = () => {
        const enabled = !sessionMetadata?.isPersistentRoom;
        onTogglePersistentRoom?.(enabled);
        postToIframe({ type: 'toggle-persistent-room', enabled });
        setSessionMetadata(prev => ({ ...prev, isPersistentRoom: enabled }));
    };

    const toggleLivestream = () => {
        const enabled = !sessionMetadata?.livestreamEnabled;
        if (enabled) {
            onConvertToLivestream?.();
            postToIframe({ type: 'start-livestream' });
        } else {
            postToIframe({ type: 'stop-livestream' });
        }
        setSessionMetadata(prev => ({ ...prev, livestreamEnabled: enabled }));
    };

    const handleSchedule = () => {
        const current = sessionMetadata?.scheduledStartAt
            ? new Date(sessionMetadata.scheduledStartAt).toISOString()
            : '';
        const input = window.prompt(
            'Введите время начала в формате ISO (оставьте пустым, чтобы снять расписание)',
            current
        );
        if (input === null) return;
        const trimmed = input.trim();
        if (!trimmed) {
            onScheduleSession?.(null);
            setSessionMetadata(prev => ({ ...prev, scheduledStartAt: undefined }));
            postToIframe({ type: 'schedule-session', scheduledStartAt: null });
            return;
        }
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) {
            window.alert('Не удалось распознать дату. Используйте формат ISO.');
            return;
        }
        onScheduleSession?.(parsed);
        setSessionMetadata(prev => ({ ...prev, scheduledStartAt: parsed }));
        postToIframe({ type: 'schedule-session', scheduledStartAt: parsed });
    };

    const formattedSchedule = useMemo(() => {
        if (!sessionMetadata?.scheduledStartAt) {
            return 'Не запланировано';
        }
        try {
            return new Date(sessionMetadata.scheduledStartAt).toLocaleString();
        } catch (error) {
            return 'Неизвестно';
        }
    }, [sessionMetadata?.scheduledStartAt]);

    const participantById = useCallback(
        (id: string) => state.participants.find(participant => participant.id === id || (participant as any).userId === id),
        [state.participants]
    );

    const handRaiseParticipants = useMemo(
        () => handRaiseQueue.map(id => ({ id, participant: participantById(id) })).filter(item => item.participant),
        [handRaiseQueue, participantById]
    );

    const speakers = useMemo(() => stageState?.speakers ?? [], [stageState?.speakers]);
    const listeners = useMemo(() => stageState?.listeners ?? [], [stageState?.listeners]);

    const handleBringToStage = (participantId: string) => {
        onBringToStage?.(participantId);
        postToIframe({ type: 'bring-to-stage', participantId });
    };

    const handleSendToAudience = (participantId: string) => {
        onSendToAudience?.(participantId);
        postToIframe({ type: 'send-to-audience', participantId });
    };

    const handleLowerHand = (participantId: string) => {
        onLowerHand?.(participantId);
        postToIframe({ type: 'lower-hand', participantId });
        setHandRaiseQueue(queue => queue.filter(id => id !== participantId));
    };

    const stageParticipants = useMemo(
        () => ({
            speakers: speakers.map(id => participantById(id)).filter(Boolean) as Participant[],
            listeners: listeners.map(id => participantById(id)).filter(Boolean) as Participant[],
        }),
        [speakers, listeners, participantById]
    );

    return (
        <div className="fixed inset-0 bg-black/90 z-50">
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <button className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary" onClick={() => requestLayout('grid')}>
                        Сетка
                    </button>
                    <button className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary" onClick={() => requestLayout('spotlight')}>
                        Фокус
                    </button>
                    <button
                        className={`px-3 py-1 rounded ${state.isScreensharing ? 'bg-indigo-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary'}`}
                        onClick={toggleScreenShare}
                        title="Демонстрация экрана"
                    >
                        Экран
                    </button>
                    <button
                        className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
                        onClick={() => postToIframe({ type: 'request-participants' })}
                    >
                        Обновить участников
                    </button>
                    <button
                        className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
                        onClick={() => setShowMetadataPanel(value => !value)}
                    >
                        Метаданные
                    </button>
                    <button
                        className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
                        onClick={() => setShowStagePanel(value => !value)}
                    >
                        Сцена
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
                        onClick={() => postToIframe({ type: 'toggle-mute' })}
                    >
                        Микрофон
                    </button>
                    <button
                        className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
                        onClick={() => postToIframe({ type: 'toggle-camera' })}
                    >
                        Камера
                    </button>
                    <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={onClose}>
                        Выйти
                    </button>
                    <button
                        className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
                        onClick={() => (showParticipants ? onHideParticipants() : postToIframe({ type: 'request-participants' }))}
                        title="Список участников"
                    >
                        👥
                    </button>
                </div>
            </div>

            <div className="absolute top-16 left-4 right-4 flex flex-wrap gap-2 z-40">
                <div className="flex items-center gap-2 bg-bg-secondary/80 px-3 py-2 rounded-lg shadow-md">
                    <button
                        className="px-3 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
                        onClick={() => {
                            onStartSession?.();
                            postToIframe({ type: 'start-session' });
                        }}
                    >
                        Старт
                    </button>
                    <button
                        className="px-3 py-1 rounded bg-amber-500 text-white hover:bg-amber-400"
                        onClick={() => {
                            onStopSession?.();
                            postToIframe({ type: 'stop-session' });
                        }}
                    >
                        Стоп
                    </button>
                    <button className="px-3 py-1 rounded bg-bg-tertiary hover:bg-bg-primary" onClick={handleSchedule}>
                        Запланировать
                    </button>
                    <div className="text-xs text-text-secondary">{formattedSchedule}</div>
                </div>
                <div className="flex items-center gap-2 bg-bg-secondary/80 px-3 py-2 rounded-lg shadow-md">
                    <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={!!sessionMetadata?.lobbyEnabled} onChange={toggleLobby} /> Лобби
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={!!sessionMetadata?.isPersistentRoom} onChange={togglePersistentRoom} /> Постоянная
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={!!sessionMetadata?.livestreamEnabled} onChange={toggleLivestream} /> Трансляция
                    </label>
                    <button className="px-3 py-1 rounded bg-bg-tertiary hover:bg-bg-primary" onClick={() => onOpenLobby?.()}>
                        Открыть лобби
                    </button>
                    <button className="px-3 py-1 rounded bg-bg-tertiary hover:bg-bg-primary" onClick={() => onConvertToLivestream?.()}>
                        В эфир
                    </button>
                </div>
            </div>

            <iframe
                ref={iframeRef}
                src={state.url}
                className="absolute inset-0 w-full h-full border-0"
                allow="camera; microphone; display-capture; clipboard-read; clipboard-write"
            />

            {showParticipants && (
                <CallParticipantsPanel participants={state.participants} onClose={onHideParticipants} />
            )}
            {showMetadataPanel && (
                <div className="fixed left-4 bottom-4 w-80 bg-bg-secondary/90 border border-border-primary rounded-xl shadow-xl p-3 z-50">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">Метаданные сессии</h3>
                        <button className="text-xs" onClick={() => setShowMetadataPanel(false)} type="button">
                            ✕
                        </button>
                    </div>
                    <dl className="space-y-1 text-sm text-text-secondary">
                        <div className="flex justify-between gap-2">
                            <dt>Запуск:</dt>
                            <dd>{formattedSchedule}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                            <dt>Лобби:</dt>
                            <dd>{sessionMetadata?.lobbyEnabled ? 'вкл.' : 'выкл.'}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                            <dt>Режим:</dt>
                            <dd>{sessionMetadata?.lobbyMode ?? 'неизвестно'}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                            <dt>Постоянная:</dt>
                            <dd>{sessionMetadata?.isPersistentRoom ? 'да' : 'нет'}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                            <dt>Трансляция:</dt>
                            <dd>{sessionMetadata?.livestreamEnabled ? 'активна' : 'выкл.'}</dd>
                        </div>
                        {sessionMetadata?.lastUpdatedAt && (
                            <div className="flex justify-between gap-2">
                                <dt>Обновлено:</dt>
                                <dd>{new Date(sessionMetadata.lastUpdatedAt).toLocaleTimeString()}</dd>
                            </div>
                        )}
                    </dl>
                    {handRaiseParticipants.length > 0 && (
                        <div className="mt-3">
                            <h4 className="text-sm font-semibold mb-2">Очередь поднятых рук</h4>
                            <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
                                {handRaiseParticipants.map(item => (
                                    <li key={item.id} className="flex items-center justify-between gap-2 text-sm bg-bg-primary/80 px-2 py-1 rounded">
                                        <span className="truncate">{item.participant?.name ?? item.id}</span>
                                        <div className="flex items-center gap-1">
                                            <button
                                                className="text-xs px-2 py-0.5 rounded bg-emerald-600 text-white"
                                                onClick={() => handleBringToStage(item.id)}
                                                type="button"
                                            >
                                                На сцену
                                            </button>
                                            <button
                                                className="text-xs px-2 py-0.5 rounded bg-bg-tertiary"
                                                onClick={() => handleLowerHand(item.id)}
                                                type="button"
                                            >
                                                Вниз
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
            {showStagePanel && (
                <div className="fixed right-4 bottom-4 w-96 bg-bg-secondary/90 border border-border-primary rounded-xl shadow-xl p-3 z-50">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="font-semibold">Управление сценой</h3>
                        <button className="text-xs" onClick={() => setShowStagePanel(false)} type="button">
                            ✕
                        </button>
                    </div>
                    <div className="space-y-3 text-sm">
                        <section>
                            <h4 className="font-semibold text-text-primary mb-1">Докладчики</h4>
                            <ul className="space-y-1 max-h-32 overflow-y-auto">
                                {stageParticipants.speakers.length > 0 ? (
                                    stageParticipants.speakers.map(participant => (
                                        <li key={participant.id} className="flex items-center justify-between gap-2 bg-bg-primary/80 px-2 py-1 rounded">
                                            <span className="truncate">{participant.name}</span>
                                            <button
                                                className="text-xs px-2 py-0.5 rounded bg-bg-tertiary"
                                                onClick={() => handleSendToAudience(participant.id)}
                                                type="button"
                                            >
                                                В зал
                                            </button>
                                        </li>
                                    ))
                                ) : (
                                    <li className="text-xs text-text-secondary">Пока нет выступающих</li>
                                )}
                            </ul>
                        </section>
                        <section>
                            <h4 className="font-semibold text-text-primary mb-1">Аудитория</h4>
                            <ul className="space-y-1 max-h-32 overflow-y-auto">
                                {stageParticipants.listeners.length > 0 ? (
                                    stageParticipants.listeners.map(participant => (
                                        <li key={participant.id} className="flex items-center justify-between gap-2 bg-bg-primary/60 px-2 py-1 rounded">
                                            <span className="truncate">{participant.name}</span>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    className="text-xs px-2 py-0.5 rounded bg-emerald-600 text-white"
                                                    onClick={() => handleBringToStage(participant.id)}
                                                    type="button"
                                                >
                                                    На сцену
                                                </button>
                                                <button
                                                    className="text-xs px-2 py-0.5 rounded bg-bg-tertiary"
                                                    onClick={() => handleLowerHand(participant.id)}
                                                    type="button"
                                                >
                                                    Руку вниз
                                                </button>
                                            </div>
                                        </li>
                                    ))
                                ) : (
                                    <li className="text-xs text-text-secondary">Аудитория пуста</li>
                                )}
                            </ul>
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GroupCallView;

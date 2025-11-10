import React from 'react';
import type { PresenceSummary } from '../utils/presence';
import { presenceStatusToClass } from '../utils/presence';

export interface Participant {
    id: string;
    name: string;
    isMuted?: boolean;
    isVideoMuted?: boolean;
    isScreenSharing?: boolean;
    isCoWatching?: boolean;
    isSpeaking?: boolean;
    avatarUrl?: string | null;
    role?: 'host' | 'moderator' | 'presenter' | 'participant';
    isLocal?: boolean;
    lastActive?: number;
    presenceSummary?: PresenceSummary;
}

interface Props {
    participants: Participant[];
    onClose?: () => void;
    onMuteToggle?: (participantId: string) => void;
    onVideoToggle?: (participantId: string) => void;
    onRemoveParticipant?: (participantId: string) => void;
    onSpotlight?: (participantId: string) => void;
    onPromotePresenter?: (participantId: string) => void;
    localUserId?: string;
    canModerate?: boolean;
}

const roleLabels: Record<NonNullable<Participant['role']>, string> = {
    host: 'Хост',
    moderator: 'Модератор',
    presenter: 'Докладчик',
    participant: 'Участник',
};

const CallParticipantsPanel: React.FC<Props> = ({
    participants,
    onClose,
    onMuteToggle,
    onVideoToggle,
    onRemoveParticipant,
    onSpotlight,
    onPromotePresenter,
    localUserId,
    canModerate = false,
}) => {
    return (
        <div className="fixed right-4 top-20 bottom-4 w-80 bg-bg-secondary border border-border-primary rounded-xl shadow-xl p-3 z-50 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Участники</h3>
                {onClose && (
                    <button className="text-sm px-2 py-1 rounded hover:bg-bg-tertiary" onClick={onClose}>
                        Закрыть
                    </button>
                )}
            </div>
            <ul className="space-y-2">
                {participants.map(p => {
                    const isSelf = p.id === localUserId || p.isLocal;
                    const highlight = p.isSpeaking ? 'border border-accent/70 shadow-lg shadow-accent/30' : 'border border-transparent';
                    return (
                        <li key={p.id} className={`flex items-start gap-3 rounded-lg px-2 py-2 bg-bg-primary/60 ${highlight}`}>
                            <div className="h-9 w-9 rounded-full bg-bg-tertiary overflow-hidden flex-shrink-0">
                                {p.avatarUrl ? (
                                    <img src={p.avatarUrl} alt={p.name} className="h-full w-full object-cover" />
                                ) : (
                                    <div className="h-full w-full flex items-center justify-center text-xs text-text-secondary">
                                        {p.name.slice(0, 2).toUpperCase()}
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium truncate">
                                        {p.name}
                                        {isSelf ? ' (Вы)' : ''}
                                    </span>
                                    {p.role && (
                                        <span className="text-[10px] uppercase tracking-wide text-text-secondary bg-bg-tertiary px-1.5 py-0.5 rounded-full">
                                            {roleLabels[p.role]}
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-text-secondary flex items-center gap-1 flex-wrap">
                                    <span>{p.isMuted ? '🔇' : '🎙️'}</span>
                                    <span>{p.isVideoMuted ? '📷 выкл.' : '📷 вкл.'}</span>
                                    {p.isScreenSharing && <span>🖥️ экран</span>}
                                    {p.isCoWatching && <span>🎬 совместно</span>}
                                    {typeof p.lastActive === 'number' && (
                                        <span className="ml-auto text-[10px] text-text-tertiary">
                                            активность {new Date(p.lastActive).toLocaleTimeString()}
                                        </span>
                                    )}
                                </div>
                                {p.presenceSummary && (
                                    <div className="mt-1 text-xs text-text-secondary flex items-center gap-2 truncate w-full">
                                        <span className={`h-2 w-2 rounded-full ${presenceStatusToClass(p.presenceSummary.status)}`} aria-hidden="true" />
                                        <span className="truncate">
                                            {p.presenceSummary.formattedUserId
                                                ? `${p.presenceSummary.formattedUserId} • ${p.presenceSummary.label}`
                                                : p.presenceSummary.label}
                                        </span>
                                    </div>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {onMuteToggle && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-secondary"
                                            onClick={() => onMuteToggle(p.id)}
                                            type="button"
                                        >
                                            {p.isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
                                        </button>
                                    )}
                                    {onVideoToggle && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-secondary"
                                            onClick={() => onVideoToggle(p.id)}
                                            type="button"
                                        >
                                            {p.isVideoMuted ? 'Включить видео' : 'Выключить видео'}
                                        </button>
                                    )}
                                    {onSpotlight && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-secondary"
                                            onClick={() => onSpotlight(p.id)}
                                            type="button"
                                        >
                                            Фокус
                                        </button>
                                    )}
                                    {canModerate && onPromotePresenter && p.role !== 'presenter' && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-tertiary hover:bg-bg-secondary"
                                            onClick={() => onPromotePresenter(p.id)}
                                            type="button"
                                        >
                                            Сделать докладчиком
                                        </button>
                                    )}
                                    {canModerate && onRemoveParticipant && !isSelf && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-red-500/80 text-white hover:bg-red-500"
                                            onClick={() => onRemoveParticipant(p.id)}
                                            type="button"
                                        >
                                            Исключить
                                        </button>
                                    )}
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default CallParticipantsPanel;

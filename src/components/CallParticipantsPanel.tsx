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
    role?: 'host' | 'moderator' | 'presenter' | 'participant' | 'listener' | 'requesting_speak';
    isLocal?: boolean;
    lastActive?: number;
    handRaisedAt?: number | null;
    presenceSummary?: PresenceSummary;
    effectsEnabled?: boolean;
}

interface Props {
    participants: Participant[];
    onClose?: () => void;
    onMuteToggle?: (participantId: string) => void;
    onVideoToggle?: (participantId: string) => void;
    onRemoveParticipant?: (participantId: string) => void;
    onSpotlight?: (participantId: string) => void;
    onPromotePresenter?: (participantId: string) => void;
    onBringToStage?: (participantId: string) => void;
    onSendToAudience?: (participantId: string) => void;
    onLowerHand?: (participantId: string) => void;
    localUserId?: string;
    canModerate?: boolean;
    captionLanguage?: string;
    captionTargetLanguage?: string;
    captionAutoTranslate?: boolean;
    captionShowForAll?: boolean;
    onCaptionLanguageChange?: (value: string) => void;
    onCaptionTargetLanguageChange?: (value: string) => void;
    onCaptionAutoTranslateChange?: (value: boolean) => void;
    onCaptionShowForAllChange?: (value: boolean) => void;
    availableLanguages?: Array<{ value: string; label: string }>;
}

const roleLabels: Record<NonNullable<Participant['role']>, string> = {
    host: 'Хост',
    moderator: 'Модератор',
    presenter: 'Докладчик',
    participant: 'Участник',
    listener: 'Слушатель',
    requesting_speak: 'Хочет выступить',
};

const DEFAULT_LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'auto', label: 'Авто' },
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'de', label: 'Deutsch' },
    { value: 'fr', label: 'Français' },
    { value: 'uk', label: 'Українська' },
    { value: 'it', label: 'Italiano' },
    { value: 'zh', label: '中文' },
];

const CallParticipantsPanel: React.FC<Props> = ({
    participants,
    onClose,
    onMuteToggle,
    onVideoToggle,
    onRemoveParticipant,
    onSpotlight,
    onPromotePresenter,
    onBringToStage,
    onSendToAudience,
    onLowerHand,
    localUserId,
    canModerate = false,
    captionLanguage = 'auto',
    captionTargetLanguage = '',
    captionAutoTranslate = false,
    captionShowForAll = false,
    onCaptionLanguageChange,
    onCaptionTargetLanguageChange,
    onCaptionAutoTranslateChange,
    onCaptionShowForAllChange,
    availableLanguages,
}) => {
    return (
        <div className="fixed right-4 top-20 bottom-4 w-80 bg-bg-secondary border border-border-primary rounded-xl shadow-xl p-3 z-50 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Участники</h3>
                {onClose && (
                    <button className="text-sm px-2 py-1 rounded hover:bg-bg-tertiary" onClick={onClose} type="button">
                        Закрыть
                    </button>
                )}
            </div>
            <div className="mb-3 space-y-2 rounded-lg bg-bg-primary/70 p-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Субтитры</span>
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                        <input
                            type="checkbox"
                            checked={captionShowForAll}
                            onChange={event => onCaptionShowForAllChange?.(event.target.checked)}
                        />
                        Показать всем
                    </label>
                </div>
                <label className="block text-xs text-text-secondary" htmlFor="caption-language-select">Язык оригинала</label>
                <select
                    id="caption-language-select"
                    className="w-full rounded-md border border-border-primary bg-bg-tertiary px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    value={captionLanguage}
                    onChange={event => onCaptionLanguageChange?.(event.target.value)}
                >
                    {(availableLanguages ?? DEFAULT_LANGUAGE_OPTIONS).map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <div className="flex items-center justify-between text-xs text-text-secondary">
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={captionAutoTranslate}
                            onChange={event => onCaptionAutoTranslateChange?.(event.target.checked)}
                        />
                        Автоперевод
                    </label>
                </div>
                <input
                    type="text"
                    placeholder="Целевой язык (например, en)"
                    className="w-full rounded-md border border-border-primary bg-bg-tertiary px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    value={captionTargetLanguage}
                    onChange={event => onCaptionTargetLanguageChange?.(event.target.value)}
                    disabled={!captionAutoTranslate}
                />
            </div>
            <ul className="space-y-2">
                {participants.map(p => {
                    const isSelf = p.id === localUserId || p.isLocal;
                    const highlight = p.isSpeaking
                        ? 'border border-accent/70 shadow-lg shadow-accent/30'
                        : 'border border-transparent';
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
                                    {p.role === 'requesting_speak' && (
                                        <span className="text-amber-300 flex items-center gap-1">
                                            ✋{typeof p.handRaisedAt === 'number' ? ` ${new Date(p.handRaisedAt).toLocaleTimeString()}` : ''}
                                        </span>
                                    )}
                                    {typeof p.lastActive === 'number' && (
                                        <span className="ml-auto text-[10px] text-text-tertiary">
                                            активность {new Date(p.lastActive).toLocaleTimeString()}
                                        </span>
                                    )}
                                </div>
                                {p.presenceSummary && (
                                    <div className="mt-1 text-xs text-text-secondary flex items-center gap-2 truncate w-full">
                                        <span
                                            className={`h-2 w-2 rounded-full ${presenceStatusToClass(p.presenceSummary.status)}`}
                                            aria-hidden="true"
                                        />
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
                                            className="text-xs px-2 py-1 rounded bg-bg-terтиary hover:bg-bg-secondary"
                                            onClick={() => onVideoToggle(p.id)}
                                            type="button"
                                        >
                                            {p.isVideoMuted ? 'Включить видео' : 'Выключить видео'}
                                        </button>
                                    )}
                                    {onToggleEffects && !isSelf && (
                                        <button
                                            className={`text-xs px-2 py-1 rounded ${
                                                p.effectsEnabled
                                                    ? 'bg-indigo-600/80 text-white hover:bg-indigo-500'
                                                    : 'bg-bg-tertiary hover:bg-bg-secondary'
                                            }`}
                                            onClick={() => onToggleEffects(p.id, !p.effectsEnabled)}
                                            type="button"
                                        >
                                            {p.effectsEnabled ? 'Отключить фон' : 'Применить фон'}
                                        </button>
                                    )}
                                    {onSpotlight && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-terтиary hover:bg-bg-secondary"
                                            onClick={() => onSpotlight(p.id)}
                                            type="button"
                                        >
                                            Фокус
                                        </button>
                                    )}
                                    {canModerate && onBringToStage && (p.role === 'listener' || p.role === 'requesting_speak') && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-indigo-600/90 text-white hover:bg-indigo-500"
                                            onClick={() => onBringToStage(p.id)}
                                            type="button"
                                        >
                                            Вывести на сцену
                                        </button>
                                    )}
                                    {canModerate && onSendToAudience && p.role && !['listener', 'requesting_speak'].includes(p.role) && !isSelf && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-terтиary hover:bg-bg-secondary"
                                            onClick={() => onSendToAudience(p.id)}
                                            type="button"
                                        >
                                            В зрители
                                        </button>
                                    )}
                                    {canModerate && onLowerHand && p.role === 'requesting_speak' && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-terтиary hover:bg-bg-secondary"
                                            onClick={() => onLowerHand(p.id)}
                                            type="button"
                                        >
                                            Опустить руку
                                        </button>
                                    )}
                                    {canModerate && onPromotePresenter && p.role !== 'presenter' && (
                                        <button
                                            className="text-xs px-2 py-1 rounded bg-bg-terтиary hover:bg-bg-secondary"
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

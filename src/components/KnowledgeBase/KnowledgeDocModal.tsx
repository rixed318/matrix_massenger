import React, { useEffect, useMemo, useState } from 'react';
import type { MatrixClient } from '@matrix-messenger/core';
import type { KnowledgeDocDraft, KnowledgeDocument } from '../../services/knowledgeBaseService';
import { createKnowledgeDocument } from '../../services/knowledgeBaseService';
import { isSpaceRoom } from '../../services/matrixService';

interface KnowledgeDocModalProps {
    isOpen: boolean;
    onClose: () => void;
    client: MatrixClient;
    initialDraft: KnowledgeDocDraft;
    onCreated?: (doc: KnowledgeDocument) => void;
}

const formatRoomName = (roomId: string, client: MatrixClient): string => {
    const room = client.getRoom(roomId);
    if (!room) {
        return roomId;
    }
    return room.name || room.getCanonicalAlias() || roomId;
};

const splitTags = (tags: string | undefined): string[] => {
    if (!tags) return [];
    return tags
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean);
};

const KnowledgeDocModal: React.FC<KnowledgeDocModalProps> = ({ isOpen, onClose, client, initialDraft, onCreated }) => {
    const [title, setTitle] = useState(initialDraft.title);
    const [body, setBody] = useState(initialDraft.body);
    const [tagsInput, setTagsInput] = useState((initialDraft.tags ?? []).join(', '));
    const [spaceId, setSpaceId] = useState<string | null>(initialDraft.spaceId ?? null);
    const [channelId, setChannelId] = useState<string | null>(initialDraft.channelId ?? initialDraft.sources[0]?.roomId ?? null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const joinedRooms = useMemo(() => {
        return client
            .getRooms()
            .filter(room => room.getMyMembership?.() === 'join')
            .sort((a, b) => (a.name || a.roomId).localeCompare(b.name || b.roomId));
    }, [client]);

    const spaces = useMemo(() => joinedRooms.filter(room => isSpaceRoom(room)), [joinedRooms]);
    const channels = useMemo(() => joinedRooms.filter(room => !isSpaceRoom(room)), [joinedRooms]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setTitle(initialDraft.title);
        setBody(initialDraft.body);
        setTagsInput((initialDraft.tags ?? []).join(', '));
        setSpaceId(initialDraft.spaceId ?? null);
        setChannelId(initialDraft.channelId ?? initialDraft.sources[0]?.roomId ?? null);
        setError(null);
        setIsSubmitting(false);
    }, [isOpen, initialDraft]);

    if (!isOpen) {
        return null;
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!title.trim()) {
            setError('Укажите заголовок статьи');
            return;
        }
        if (!body.trim()) {
            setError('Добавьте содержимое статьи');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        const draft: KnowledgeDocDraft = {
            ...initialDraft,
            title: title.trim(),
            body: body.trim(),
            tags: splitTags(tagsInput),
            spaceId: spaceId ?? undefined,
            channelId: channelId ?? undefined,
        };

        try {
            const doc = await createKnowledgeDocument(client, draft);
            onCreated?.(doc);
            onClose();
        } catch (err) {
            console.error('Failed to create knowledge document', err);
            setError('Не удалось сохранить статью. Попробуйте ещё раз.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
            <div
                className="w-full max-w-2xl rounded-xl bg-bg-primary shadow-2xl"
                onClick={event => event.stopPropagation()}
            >
                <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-6">
                    <header className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-text-primary">Сохранить в базу знаний</h2>
                            <p className="text-sm text-text-secondary">
                                Отредактируйте описание и выберите пространство для публикации
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-full p-2 text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                            aria-label="Закрыть"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                                <path
                                    fillRule="evenodd"
                                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                    clipRule="evenodd"
                                />
                            </svg>
                        </button>
                    </header>

                    <div className="space-y-1">
                        <label htmlFor="knowledge-title" className="text-sm font-medium text-text-secondary">
                            Заголовок
                        </label>
                        <input
                            id="knowledge-title"
                            type="text"
                            value={title}
                            onChange={event => setTitle(event.target.value)}
                            className="w-full rounded-lg border border-border-primary bg-bg-secondary px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
                            placeholder="Чёткое имя статьи"
                        />
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="knowledge-body" className="text-sm font-medium text-text-secondary">
                            Содержимое
                        </label>
                        <textarea
                            id="knowledge-body"
                            value={body}
                            onChange={event => setBody(event.target.value)}
                            className="h-48 w-full resize-y rounded-lg border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                            placeholder="Добавьте детали, ссылки и форматирование"
                        />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1">
                            <label htmlFor="knowledge-space" className="text-sm font-medium text-text-secondary">
                                Пространство (Space)
                            </label>
                            <select
                                id="knowledge-space"
                                value={spaceId ?? ''}
                                onChange={event => setSpaceId(event.target.value || null)}
                                className="w-full rounded-lg border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                            >
                                <option value="">— Без привязки —</option>
                                {spaces.map(space => (
                                    <option key={space.roomId} value={space.roomId}>
                                        {formatRoomName(space.roomId, client)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label htmlFor="knowledge-channel" className="text-sm font-medium text-text-secondary">
                                Канал публикации
                            </label>
                            <select
                                id="knowledge-channel"
                                value={channelId ?? ''}
                                onChange={event => setChannelId(event.target.value || null)}
                                className="w-full rounded-lg border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                            >
                                <option value="">— Выберите канал —</option>
                                {channels.map(channel => (
                                    <option key={channel.roomId} value={channel.roomId}>
                                        {formatRoomName(channel.roomId, client)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label htmlFor="knowledge-tags" className="text-sm font-medium text-text-secondary">
                            Теги (через запятую)
                        </label>
                        <input
                            id="knowledge-tags"
                            type="text"
                            value={tagsInput}
                            onChange={event => setTagsInput(event.target.value)}
                            className="w-full rounded-lg border border-border-primary bg-bg-secondary px-3 py-2 text-text-primary focus:border-accent focus:outline-none"
                            placeholder="например: onboarding, инструкции"
                        />
                    </div>

                    {initialDraft.sources.length > 0 && (
                        <div className="rounded-lg bg-bg-secondary/60 p-3 text-xs text-text-secondary">
                            Ссылка на сообщения: {initialDraft.sources.map(source => formatRoomName(source.roomId, client)).join(', ')}
                        </div>
                    )}

                    {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}

                    <footer className="flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-text-inverted transition hover:bg-accent/90 disabled:opacity-60"
                        >
                            {isSubmitting ? 'Сохраняем…' : 'Сохранить'}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
};

export default KnowledgeDocModal;


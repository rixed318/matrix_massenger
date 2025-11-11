import React, { useEffect, useMemo, useState } from 'react';
import type { MatrixClient } from '@matrix-messenger/core';
import {
    subscribeKnowledgeDocuments,
    getKnowledgeDocuments,
    searchKnowledgeDocuments,
    type KnowledgeDocument,
} from '../../services/knowledgeBaseService';

interface KnowledgeBasePanelProps {
    client?: MatrixClient;
    className?: string;
    onSelectDocument?: (doc: KnowledgeDocument) => void;
}

const formatRoomName = (client: MatrixClient | undefined, roomId: string | null | undefined): string => {
    if (!roomId) {
        return '';
    }
    const room = client?.getRoom(roomId);
    return room?.name || room?.getCanonicalAlias() || roomId;
};

const formatTimestamp = (timestamp: number): string => {
    try {
        return new Date(timestamp).toLocaleString();
    } catch (error) {
        console.warn('Failed to format knowledge doc timestamp', error);
        return '';
    }
};

const KnowledgeBasePanel: React.FC<KnowledgeBasePanelProps> = ({ client, className = '', onSelectDocument }) => {
    const [documents, setDocuments] = useState<KnowledgeDocument[]>(() => getKnowledgeDocuments());
    const [searchValue, setSearchValue] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedTag, setSelectedTag] = useState<string>('');
    const [selectedSpace, setSelectedSpace] = useState<string>('');
    const [selectedChannel, setSelectedChannel] = useState<string>('');
    const [results, setResults] = useState<KnowledgeDocument[]>(documents);
    const [isSearching, setIsSearching] = useState(false);

    useEffect(() => {
        const unsubscribe = subscribeKnowledgeDocuments(setDocuments);
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const handle = window.setTimeout(() => {
            setDebouncedSearch(searchValue.trim());
        }, 250);
        return () => window.clearTimeout(handle);
    }, [searchValue]);

    const allTags = useMemo(() => {
        const set = new Set<string>();
        documents.forEach(doc => (doc.tags ?? []).forEach(tag => set.add(tag.toLowerCase())));
        return Array.from(set.values()).sort();
    }, [documents]);

    const availableSpaces = useMemo(() => {
        const set = new Set<string>();
        documents.forEach(doc => {
            if (doc.spaceId) {
                set.add(doc.spaceId);
            }
        });
        return Array.from(set.values()).sort();
    }, [documents]);

    const availableChannels = useMemo(() => {
        const set = new Set<string>();
        documents.forEach(doc => {
            if (doc.channelId) {
                set.add(doc.channelId);
            }
        });
        return Array.from(set.values()).sort();
    }, [documents]);

    const applyStaticFilters = useMemo(() => {
        const tagFilter = selectedTag ? selectedTag.toLowerCase() : '';
        return documents.filter(doc => {
            if (tagFilter) {
                const hasTag = (doc.tags ?? []).map(tag => tag.toLowerCase()).includes(tagFilter);
                if (!hasTag) {
                    return false;
                }
            }
            if (selectedSpace && doc.spaceId !== selectedSpace) {
                return false;
            }
            if (selectedChannel && doc.channelId !== selectedChannel) {
                return false;
            }
            return true;
        });
    }, [documents, selectedTag, selectedSpace, selectedChannel]);

    useEffect(() => {
        if (!debouncedSearch) {
            setResults(applyStaticFilters);
            setIsSearching(false);
            return;
        }

        let cancelled = false;
        setIsSearching(true);
        searchKnowledgeDocuments({
            term: debouncedSearch,
            spaceId: selectedSpace || undefined,
            channelId: selectedChannel || undefined,
            tags: selectedTag ? [selectedTag] : undefined,
        })
            .then(list => {
                if (!cancelled) {
                    const ids = new Set(list.map(doc => doc.id));
                    const filtered = applyStaticFilters.filter(doc => ids.has(doc.id));
                    setResults(filtered);
                }
            })
            .catch(error => {
                console.warn('Knowledge search failed', error);
                if (!cancelled) {
                    setResults(applyStaticFilters);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsSearching(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [debouncedSearch, selectedSpace, selectedChannel, selectedTag, applyStaticFilters]);

    const handleSelect = (doc: KnowledgeDocument) => {
        onSelectDocument?.(doc);
    };

    return (
        <section className={`rounded-lg border border-border-primary bg-bg-primary p-4 ${className}`.trim()}>
            <header className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                    <h3 className="text-base font-semibold text-text-primary">База знаний</h3>
                    <p className="text-xs text-text-secondary">{documents.length} статей доступно локально</p>
                </div>
                <input
                    type="search"
                    value={searchValue}
                    onChange={event => setSearchValue(event.target.value)}
                    placeholder="Поиск по заголовкам и тексту"
                    className="w-full rounded-lg border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none md:w-64"
                />
            </header>

            <div className="mb-4 grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
                    Тег
                    <select
                        value={selectedTag}
                        onChange={event => setSelectedTag(event.target.value)}
                        className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                        <option value="">Все</option>
                        {allTags.map(tag => (
                            <option key={tag} value={tag}>
                                {tag}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
                    Пространство
                    <select
                        value={selectedSpace}
                        onChange={event => setSelectedSpace(event.target.value)}
                        className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                        <option value="">Все</option>
                        {availableSpaces.map(space => (
                            <option key={space} value={space}>
                                {formatRoomName(client, space)}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
                    Канал
                    <select
                        value={selectedChannel}
                        onChange={event => setSelectedChannel(event.target.value)}
                        className="rounded-lg border border-border-primary bg-bg-secondary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                        <option value="">Все</option>
                        {availableChannels.map(channel => (
                            <option key={channel} value={channel}>
                                {formatRoomName(client, channel)}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <div className="space-y-3">
                {isSearching && <div className="text-sm text-text-secondary">Поиск статей…</div>}
                {!isSearching && results.length === 0 && (
                    <div className="rounded-lg border border-dashed border-border-primary/60 bg-bg-secondary/40 p-6 text-center text-sm text-text-secondary">
                        Статьи не найдены. Попробуйте изменить фильтры или запрос.
                    </div>
                )}
                {!isSearching &&
                    results.map(doc => (
                        <article
                            key={doc.id}
                            className="cursor-pointer rounded-lg border border-border-primary bg-bg-secondary/40 p-4 transition hover:border-accent/80 hover:bg-bg-secondary"
                            onClick={() => handleSelect(doc)}
                        >
                            <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
                                <h4 className="text-lg font-semibold text-text-primary">{doc.title || 'Без названия'}</h4>
                                <span className="text-xs text-text-secondary">
                                    Обновлено {formatTimestamp(doc.updatedAt)}
                                </span>
                            </div>
                            {doc.summary && (
                                <p className="mt-1 text-sm text-text-secondary line-clamp-3">{doc.summary}</p>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-secondary">
                                <span className="rounded-full bg-bg-tertiary px-2 py-1">
                                    {doc.channelId ? formatRoomName(client, doc.channelId) : 'Канал не выбран'}
                                </span>
                                <span className="rounded-full bg-bg-tertiary px-2 py-1">
                                    {doc.spaceId ? formatRoomName(client, doc.spaceId) : 'Space не выбран'}
                                </span>
                                {(doc.tags ?? []).map(tag => (
                                    <span key={tag} className="rounded-full bg-accent/10 px-2 py-1 text-text-accent">
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        </article>
                    ))}
            </div>
        </section>
    );
};

export default KnowledgeBasePanel;


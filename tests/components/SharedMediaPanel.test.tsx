import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SharedMediaPanel from '../../src/components/SharedMediaPanel';
import type { RoomMediaSummary, RoomMediaItem } from '../../src/services/matrixService';

describe('SharedMediaPanel', () => {
    const createItem = (overrides: Partial<RoomMediaItem>): RoomMediaItem => ({
        eventId: overrides.eventId ?? `event-${Math.random()}`,
        roomId: '!room:example.org',
        timestamp: overrides.timestamp ?? Date.now(),
        senderId: overrides.senderId ?? '@user:example.org',
        senderName: overrides.senderName ?? 'User',
        senderAvatarUrl: overrides.senderAvatarUrl ?? null,
        body: overrides.body,
        mimetype: overrides.mimetype,
        size: overrides.size,
        url: overrides.url,
        thumbnailUrl: overrides.thumbnailUrl,
        info: overrides.info ?? null,
        eventType: overrides.eventType ?? 'm.image',
        category: overrides.category ?? 'media',
        isVoiceMessage: overrides.isVoiceMessage,
        linkUrl: overrides.linkUrl ?? null,
        geoUri: overrides.geoUri ?? null,
    });

    const baseSummary: RoomMediaSummary = {
        itemsByCategory: {
            media: [
                createItem({
                    eventId: 'm1',
                    body: 'Holiday photo',
                    url: 'https://example.org/image.jpg',
                    category: 'media',
                    eventType: 'm.image',
                    timestamp: new Date('2024-01-15T10:00:00Z').getTime(),
                    senderId: '@user:example.org',
                    senderName: 'User',
                }),
                createItem({
                    eventId: 'm2',
                    body: 'Winter party',
                    url: 'https://example.org/party.jpg',
                    category: 'media',
                    eventType: 'm.image',
                    timestamp: new Date('2023-12-20T10:00:00Z').getTime(),
                    senderId: '@other:example.org',
                    senderName: 'Colleague',
                }),
            ],
            files: [
                createItem({ eventId: 'f1', body: 'Budget.xlsx', url: 'https://example.org/file', size: 2048, category: 'files', eventType: 'm.file' }),
            ],
            links: [
                createItem({ eventId: 'l1', body: 'Map link', linkUrl: 'https://maps.example.org', category: 'links', eventType: 'm.location' }),
            ],
            voice: [
                createItem({ eventId: 'v1', body: 'Voice memo', url: 'https://example.org/audio.ogg', category: 'voice', eventType: 'm.audio', isVoiceMessage: true }),
            ],
        },
        countsByCategory: { media: 2, files: 1, links: 1, voice: 1 },
        hasMore: true,
        eventIds: ['m1', 'm2', 'f1', 'l1', 'v1'],
    };

    it('renders media categories and filter controls', () => {
        render(
            <SharedMediaPanel
                isOpen
                onClose={() => {}}
                data={baseSummary}
                isLoading={false}
                isPaginating={false}
                onLoadMore={() => {}}
                currentUserId="@user:example.org"
            />,
        );

        expect(screen.getByText('Shared media')).toBeInTheDocument();
        expect(screen.getByText('Медиа')).toBeInTheDocument();
        expect(screen.getByText('Файлы')).toBeInTheDocument();
        expect(screen.getByText('Ссылки')).toBeInTheDocument();
        expect(screen.getByText('Голосовые')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Поиск по названию, ссылке или отправителю')).toBeInTheDocument();
        expect(screen.getByText('Таймлайн')).toBeInTheDocument();
    });

    it('switches tabs and triggers load more', () => {
        const onLoadMore = vi.fn();
        render(
            <SharedMediaPanel
                isOpen
                onClose={() => {}}
                data={baseSummary}
                isLoading={false}
                isPaginating={false}
                onLoadMore={onLoadMore}
                currentUserId="@user:example.org"
            />,
        );

        fireEvent.click(screen.getByText('Файлы'));
        expect(screen.getByText('Budget.xlsx')).toBeInTheDocument();

        const loadMoreButton = screen.getByRole('button', { name: 'Загрузить ещё' });
        fireEvent.click(loadMoreButton);
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('applies search filter and shows empty state', async () => {
        render(
            <SharedMediaPanel
                isOpen
                onClose={() => {}}
                data={baseSummary}
                isLoading={false}
                isPaginating={false}
                onLoadMore={() => {}}
                currentUserId="@user:example.org"
            />,
        );

        const searchInput = screen.getByPlaceholderText('Поиск по названию, ссылке или отправителю');
        fireEvent.change(searchInput, { target: { value: 'несуществующий запрос' } });

        const emptyMessage = await screen.findByText('Ничего не найдено.');
        expect(emptyMessage).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument();
    });

    it('filters to only my items when quick tag enabled', async () => {
        const summary: RoomMediaSummary = {
            ...baseSummary,
            itemsByCategory: {
                ...baseSummary.itemsByCategory,
                media: [
                    createItem({
                        eventId: 'mine',
                        body: 'My photo',
                        category: 'media',
                        eventType: 'm.image',
                        senderId: '@user:example.org',
                        senderName: 'User',
                        timestamp: new Date('2024-02-02T10:00:00Z').getTime(),
                    }),
                    createItem({
                        eventId: 'other',
                        body: 'Other photo',
                        category: 'media',
                        eventType: 'm.image',
                        senderId: '@other:example.org',
                        senderName: 'Colleague',
                        timestamp: new Date('2024-02-03T10:00:00Z').getTime(),
                    }),
                ],
            },
            countsByCategory: { ...baseSummary.countsByCategory, media: 2 },
        };

        render(
            <SharedMediaPanel
                isOpen
                onClose={() => {}}
                data={summary}
                isLoading={false}
                isPaginating={false}
                onLoadMore={() => {}}
                currentUserId="@user:example.org"
            />,
        );

        const quickTag = screen.getByRole('button', { name: 'Только мои' });
        fireEvent.click(quickTag);

        expect(await screen.findByText('My photo')).toBeInTheDocument();
        expect(screen.queryByText('Other photo')).not.toBeInTheDocument();
    });
});

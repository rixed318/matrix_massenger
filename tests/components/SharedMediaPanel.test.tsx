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
                createItem({ eventId: 'm1', body: 'Holiday photo', url: 'https://example.org/image.jpg', category: 'media', eventType: 'm.image' }),
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
        countsByCategory: { media: 1, files: 1, links: 1, voice: 1 },
        hasMore: true,
        eventIds: ['m1', 'f1', 'l1', 'v1'],
    };

    it('renders media categories and matches snapshot', () => {
        const { asFragment } = render(
            <SharedMediaPanel
                isOpen
                onClose={() => {}}
                data={baseSummary}
                isLoading={false}
                isPaginating={false}
                onLoadMore={() => {}}
            />,
        );

        expect(screen.getByText('Shared media')).toBeInTheDocument();
        expect(screen.getByText('Медиа')).toBeInTheDocument();
        expect(screen.getByText('Файлы')).toBeInTheDocument();
        expect(screen.getByText('Ссылки')).toBeInTheDocument();
        expect(screen.getByText('Голосовые')).toBeInTheDocument();
        expect(asFragment()).toMatchSnapshot();
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
            />,
        );

        fireEvent.click(screen.getByText('Файлы'));
        expect(screen.getByText('Budget.xlsx')).toBeInTheDocument();

        const loadMoreButton = screen.getByRole('button', { name: 'Загрузить ещё' });
        fireEvent.click(loadMoreButton);
        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });
});

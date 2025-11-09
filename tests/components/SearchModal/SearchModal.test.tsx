import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SearchModal from '../../../src/components/SearchModal';
import type { MatrixClient, Room } from '../../../src/types';
import { vi, describe, it, beforeEach, expect } from 'vitest';

const searchMessagesMock = vi.fn();

vi.mock('@matrix-messenger/core', () => ({
    searchMessages: searchMessagesMock,
}));

const createRoom = (overrides: Partial<Room> = {}): Room => ({
    roomId: '!room:example',
    name: 'Комната 1',
    avatarUrl: null,
    lastMessage: null,
    unreadCount: 0,
    pinnedEvents: [],
    isEncrypted: false,
    isDirectMessageRoom: false,
    ...overrides,
});

describe('SearchModal', () => {
    const client = {} as MatrixClient;
    const rooms = [
        createRoom({ roomId: '!room:example', name: 'Общий чат' }),
        createRoom({ roomId: '!room:second', name: 'Рабочая комната' }),
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        searchMessagesMock.mockResolvedValue({
            count: 0,
            highlights: [],
            nextBatch: undefined,
            results: [],
        });
    });

    it('passes selected filters to searchMessages', async () => {
        render(
            <SearchModal
                isOpen
                onClose={vi.fn()}
                client={client}
                rooms={rooms}
                onSelectResult={vi.fn()}
            />,
        );

        const queryInput = screen.getByPlaceholderText('Найдите сообщения по всему аккаунту...');
        fireEvent.change(queryInput, { target: { value: 'Привет' } });

        const roomSelect = screen.getByRole('combobox', { name: 'Комната' });
        fireEvent.change(roomSelect, { target: { value: '!room:second' } });

        const typeSelect = screen.getByRole('listbox', { name: 'Типы событий' });
        fireEvent.change(typeSelect, {
            target: {
                selectedOptions: [
                    { value: 'm.room.message' },
                ],
            },
        });

        const senderInput = screen.getByLabelText('Добавить отправителя');
        fireEvent.change(senderInput, { target: { value: '@alice:example' } });
        fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

        const senderCheckbox = screen.getByLabelText('Отправитель');
        fireEvent.click(senderCheckbox);

        const fromInput = screen.getByLabelText('Дата начала');
        fireEvent.change(fromInput, { target: { value: '2024-05-01' } });
        const toInput = screen.getByLabelText('Дата окончания');
        fireEvent.change(toInput, { target: { value: '2024-05-31' } });

        const mediaCheckbox = screen.getByLabelText('Только сообщения с медиа');
        fireEvent.click(mediaCheckbox);

        const submitButton = screen.getByRole('button', { name: 'Искать' });
        fireEvent.click(submitButton);

        await waitFor(() => expect(searchMessagesMock).toHaveBeenCalled());
        const [, options] = searchMessagesMock.mock.calls[0];

        expect(options).toMatchObject({
            searchTerm: 'Привет',
            roomId: '!room:second',
            senders: ['@alice:example'],
            messageTypes: ['m.room.message'],
            hasMedia: true,
            dateRange: { from: '2024-05-01', to: '2024-05-31' },
        });
        expect(options.keys).toEqual(expect.arrayContaining(['content.body', 'sender']));

        await waitFor(() => {
            expect(screen.getByText('Комната: Рабочая комната')).toBeInTheDocument();
            expect(screen.getByText('Отправители: @alice:example')).toBeInTheDocument();
            expect(screen.getByText('Типы: m.room.message')).toBeInTheDocument();
            expect(screen.getByText('Медиа: Только сообщения с медиа')).toBeInTheDocument();
            expect(screen.getByText('Поля поиска: content.body, sender')).toBeInTheDocument();
        });
    });

    it('resets filters and triggers new search on clear', async () => {
        render(
            <SearchModal
                isOpen
                onClose={vi.fn()}
                client={client}
                rooms={rooms}
                onSelectResult={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByPlaceholderText('Найдите сообщения по всему аккаунту...'), {
            target: { value: 'Matrix' },
        });

        const senderInput = screen.getByLabelText('Добавить отправителя');
        fireEvent.change(senderInput, { target: { value: '@bob:example' } });
        fireEvent.keyDown(senderInput, { key: 'Enter', code: 'Enter' });

        const mediaCheckbox = screen.getByLabelText('Только сообщения с медиа');
        fireEvent.click(mediaCheckbox);

        fireEvent.click(screen.getByRole('button', { name: 'Искать' }));
        await waitFor(() => expect(searchMessagesMock).toHaveBeenCalledTimes(1));

        const clearButton = screen.getByRole('button', { name: 'Очистить' });
        fireEvent.click(clearButton);

        await waitFor(() => expect(searchMessagesMock).toHaveBeenCalledTimes(2));
        const [, resetOptions] = searchMessagesMock.mock.calls[1];

        expect(resetOptions.roomId).toBeUndefined();
        expect(resetOptions.senders).toBeUndefined();
        expect(resetOptions.messageTypes).toBeUndefined();
        expect(resetOptions.hasMedia).toBe(false);
        expect(resetOptions.dateRange).toBeUndefined();
        expect(resetOptions.keys).toEqual(['content.body']);

        await waitFor(() => {
            expect(screen.queryByText(/Отправители:/)).toBeNull();
            expect(screen.queryByText(/Медиа:/)).toBeNull();
        });
    });
});

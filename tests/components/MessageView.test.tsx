import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import MessageView from '../../src/components/MessageView';
import { Message, MatrixClient } from '../../src/types';

const ITEM_HEIGHT = 120;
const INITIAL_MESSAGES = 20;
const PREPENDED_MESSAGES = 5;

vi.mock('@matrix-messenger/core', async () => {
    const actual = await vi.importActual<typeof import('../../src/types')>('../../src/types');
    return {
        __esModule: true,
        ...actual,
        mxcToHttp: () => null,
    };
});

class ResizeObserverStub {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }
    observe() {
        // No-op in test environment; initial measurement happens eagerly.
    }
    unobserve() {}
    disconnect() {}
}

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

beforeAll(() => {
    // @ts-expect-error jsdom missing ResizeObserver
    global.ResizeObserver = ResizeObserverStub;

    Element.prototype.getBoundingClientRect = function () {
        if ((this as HTMLElement).dataset.virtualizedMessage === 'true') {
            const heightAttr = (this as HTMLElement).dataset.testHeight;
            const height = heightAttr ? Number(heightAttr) : ITEM_HEIGHT;
            return {
                x: 0,
                y: 0,
                width: 320,
                height,
                top: 0,
                right: 320,
                bottom: height,
                left: 0,
                toJSON: () => ({}),
            } as DOMRect;
        }
        return originalGetBoundingClientRect.call(this);
    };
});

afterAll(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

const createMessage = (id: string, body: string): Message => ({
    id,
    sender: { id: '@user:server', name: 'User', avatarUrl: null },
    content: { body, msgtype: 'm.text' },
    timestamp: Date.now(),
    isOwn: false,
    reactions: null,
    isEdited: false,
    isRedacted: false,
    replyTo: null,
    readBy: {},
    threadReplyCount: 0,
});

const clientStub = {
    getUserId: () => '@user:server',
} as unknown as MatrixClient;

const initialMessages: Message[] = Array.from({ length: INITIAL_MESSAGES }, (_, index) =>
    createMessage(`msg-${index}`, `Message ${index}`)
);

const prependedMessages: Message[] = Array.from({ length: PREPENDED_MESSAGES }, (_, index) =>
    createMessage(`older-${index}`, `Older ${index}`)
);

const noop = () => {};

const renderMessageView = () => {
    const TestHarness: React.FC = () => {
        const [messages, setMessages] = React.useState<Message[]>(initialMessages);
        const [isPaginating, setIsPaginating] = React.useState(false);
        const hasPaginatedRef = React.useRef(false);
        const scrollRef = React.useRef<HTMLDivElement>(null);

        const handlePaginate = React.useCallback(() => {
            if (hasPaginatedRef.current) return;
            hasPaginatedRef.current = true;
            setIsPaginating(true);
            setMessages((prev) => [...prependedMessages, ...prev]);
            setIsPaginating(false);
        }, []);

        return (
            <MessageView
                messages={messages}
                client={clientStub}
                onReaction={noop}
                onEditMessage={noop}
                onDeleteMessage={noop}
                onSetReplyTo={noop}
                onForwardMessage={noop}
                onImageClick={noop}
                onOpenThread={noop}
                onPollVote={noop}
                onTranslateMessage={noop}
                translatedMessages={{}}
                scrollContainerRef={scrollRef}
                onScroll={noop}
                onPaginate={handlePaginate}
                isPaginating={isPaginating}
                canPaginate
                pinnedEventIds={[]}
                canPin={false}
                onPinToggle={noop}
                highlightedMessageId={null}
            />
        );
    };

    return render(<TestHarness />);
};

describe('MessageView virtualization', () => {
    it('preserves scroll position when older messages are prepended', async () => {
        const { getByTestId } = renderMessageView();
        const container = getByTestId('message-scroll-container') as HTMLDivElement;

        Object.defineProperty(container, 'clientHeight', {
            configurable: true,
            get: () => 400,
        });

        let currentScrollHeight = INITIAL_MESSAGES * ITEM_HEIGHT;
        Object.defineProperty(container, 'scrollHeight', {
            configurable: true,
            get: () => currentScrollHeight,
        });

        await act(async () => {
            fireEvent.scroll(container, { target: { scrollTop: 0 } });
            currentScrollHeight = (INITIAL_MESSAGES + PREPENDED_MESSAGES) * ITEM_HEIGHT;
        });

        await waitFor(() => {
            expect(container.scrollTop).toBe(PREPENDED_MESSAGES * ITEM_HEIGHT);
        });
    });
});

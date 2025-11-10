import { describe, expect, it } from 'vitest';

import { parseScheduledMessagesFromEvent } from '../../src/services/schedulerService';
import type { MatrixEvent } from '../../src/types';

const createStateEvent = (content: unknown, roomId = '!test:room'): MatrixEvent => ({
  getContent: () => content,
  getRoomId: () => roomId,
} as unknown as MatrixEvent);

describe('schedulerService state event parsing', () => {
  const baseMessage = {
    id: 'sched_1',
    roomId: '!test:room',
    content: { plain: 'message', attachments: [] },
    sendAt: 1700000000000,
    sendAtUtc: 1700000000000,
  };

  it('discards recurrence definitions with non-positive intervals', () => {
    const event = createStateEvent({
      messages: [
        {
          ...baseMessage,
          recurrence: { mode: 'repeat', intervalMs: 0, maxOccurrences: 5 },
        },
      ],
    });

    const { messages } = parseScheduledMessagesFromEvent(event);

    expect(messages).toHaveLength(1);
    expect(messages[0].recurrence).toBeUndefined();
  });

  it('normalizes recurrence values from state events', () => {
    const event = createStateEvent({
      messages: [
        {
          ...baseMessage,
          recurrence: {
            mode: 'repeat',
            intervalMs: 90000.8,
            maxOccurrences: '5',
            untilUtc: '1700000500000',
          },
        },
      ],
    });

    const { messages } = parseScheduledMessagesFromEvent(event);

    expect(messages[0].recurrence).toEqual({
      mode: 'repeat',
      intervalMs: 90000,
      maxOccurrences: 5,
      untilUtc: 1700000500000,
    });
  });

  it('ignores recurrence definitions with mode "once"', () => {
    const event = createStateEvent({
      messages: [
        {
          ...baseMessage,
          recurrence: { mode: 'once', intervalMs: 60000 },
        },
      ],
    });

    const { messages } = parseScheduledMessagesFromEvent(event);

    expect(messages[0].recurrence).toBeUndefined();
  });
});

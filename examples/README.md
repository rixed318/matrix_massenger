# Plugin and bot examples

The `examples/` directory contains ready-to-run samples that illustrate how to build Matrix Messenger extensions on top of `@matrix-messenger/sdk`.

| Example | Description |
| --- | --- |
| [`echo-bot`](./echo-bot/) | Minimal echo command that repeats user input and demonstrates event subscriptions. |
| [`reminder-bot`](./reminder-bot/) | Schedules follow-up messages using the scheduler and persistent storage. |

Each example uses TypeScript, targets Node.js ≥ 18, and references the local workspace SDK during development.

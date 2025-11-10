# Bot Bridge

Bot Bridge обеспечивает интеграцию внешних платформ автоматизации (Slack, Teams, Helpdesk и т.д.) с Matrix. Начиная с этой версии поддерживаются множественные коннекторы с отдельными манифестами, OAuth/API ключами и обработкой входящих вебхуков.

## Конфигурация

Конфигурация выполняется через `configureBotBridge`:

```ts
configureBotBridge({
  defaultConnectorId: 'slack',
  defaultTimeoutMs: 15_000,
  connectors: {
    slack: {
      id: 'slack',
      baseUrl: 'https://bridge.example.com/slack',
      manifestUrl: '/manifest.json',
      headers: { 'x-environment': 'prod' },
      retry: { maxAttempts: 4, initialDelayMs: 500 },
    },
    teams: {
      id: 'teams',
      baseUrl: 'https://bridge.example.com/teams',
      manifestUrl: '/manifest.json',
    },
  },
});
```

Каждый коннектор хранит:

* `manifestUrl` — путь до JSON-манифеста (описание возможностей, схемы авторизации, дополнительные поля конфигурации).
* `auth` — текущее состояние авторизации (`scheme`, токены, API ключи).
* `retry` — параметры повторов (количество попыток, backoff и т.д.).

### Манифест коннектора

Метод `loadConnectorManifest(connectorId)` скачивает и кэширует JSON-манифест. Ожидаемая структура:

```json
{
  "id": "slack",
  "displayName": "Slack",
  "capabilities": ["messages", "files"],
  "auth": "oauth2",
  "oauth": {
    "authorizeUrl": "https://slack.com/oauth/v2/authorize",
    "tokenUrl": "https://slack.com/api/oauth.v2.access",
    "scopes": ["channels:history", "files:read"]
  },
  "webhookEvents": [{ "event": "file.uploaded", "path": "/webhooks/slack" }]
}
```

## Хранение секретов

Секреты каждого коннектора сохраняются через `botBridgeSecretsStore`:

* в Tauri — через `tauri-plugin-secure-storage`;
* в Expo — через `expo-secure-store` (зависимость добавлена в `mobile/package.json`);
* в браузере — безопасный fallback в `localStorage` (для отладки).

Интерфейс `PersistedConnectorSecrets` совместим с `BotBridgeConnectorAuthState`, что позволяет напрямую применять сохранённые данные через `updateConnectorAuth`.

## Настройки в UI

Компонент `BotBridgeSettingsModal` отображает список коннекторов, статус подключения, поля для API ключей и OAuth токенов, а также позволяет выбрать коннектор по умолчанию. Все изменения сразу синхронизируются с безопасным хранилищем и `botBridge`-конфигурацией.

## Вебхуки и синхронизация

* В Tauri добавлена команда `ingest_bot_bridge_webhook`, публикующая событие `bot-bridge://webhook` во фронтенд.
* `botBridgeWebhook` предоставляет универсальный подписчик (`onBotBridgeWebhook`) и эмиттер.
* `botBridgeSync` реализует обработчики событий `invite` и `file.uploaded` — приглашает пользователя в комнату и пересылает файловые вложения в Matrix.

## Тестирование

* Юнит-тесты `tests/services/botBridge.test.ts` покрывают много-коннекторный режим, retry и парсинг ошибок.
* `tests/services/botBridgeSync.test.ts` проверяет обработку приглашений и файлов.
* `tests/components/BotBridgeSettingsModal.test.tsx` гарантирует сохранение API ключей и выбор коннектора по умолчанию.

Запуск: `npm test` (используется Vitest).

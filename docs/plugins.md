# Плагины Matrix Messenger

Этот документ описывает расширенную модель плагинов Matrix Messenger, включая UI-поверхности и новые события.

## Manifest

Пример манифеста:

```json
{
  "id": "demo.echo",
  "name": "Echo bot",
  "entry": "./echo-bot.js",
  "version": "1.1.0",
  "permissions": ["sendTextMessage", "ui.panel"],
  "requiredEvents": ["matrix.message", "ui.action"],
  "surfaces": [
    {
      "id": "echo-control",
      "location": "chat.panel",
      "entry": "./echo-panel.html",
      "label": "Echo Panel",
      "description": "Мини-приложение для отправки тестовых сообщений",
      "csp": "default-src 'self'; script-src 'self'; frame-ancestors 'self'"
    }
  ]
}
```

### Новые поля

- `capabilities`: произвольные маркеры возможностей плагина.
- `surfaces`: описание UI-поверхностей (iframe/mini-app).
  - `location` может быть `chat.panel` или `chat.composer`.
  - `csp` позволяет явно задать ожидаемую Content-Security-Policy, если сервер не возвращает заголовок.

### Разрешения

Добавлены новые разрешения:

- `ui.panel` — плагин может встраивать интерфейс в приложение.
- `background` — разрешение на фоновую работу (в планах, пока не используется).

Каталог плагинов отображает расшифровку разрешений и список поверхностей.

## UI API

В песочнице доступен `ctx.ui.render(surfaceId, payload)`. Плагин может подписаться на события:

- `ui.render` — вызывается хостом, когда поверхность готова к отображению.
- `ui.action` — пользовательское действие в мини-приложении.

Мини-приложение общается с хостом через `window.postMessage`:

```js
window.parent.postMessage({ type: 'ui.ready', surfaceId: 'echo-control' }, '*');
window.parent.postMessage({ type: 'ui.action', surfaceId: 'echo-control', action: 'send.echo', payload: { text: 'hello' } }, '*');
```

Ответ от плагина приходит через `ui.render`:

```js
window.addEventListener('message', event => {
  if (event.data?.type === 'ui.render') {
    updateUI(event.data.payload);
  }
});
```

## Content-Security-Policy

Перед загрузкой iframe хост выполняет HEAD-запрос к `entry` и проверяет директиву `frame-ancestors`. Если заголовок недоступен, используется значение из поля `csp`. При нарушении политика блокирует поверхность.

## Пример mini-app

В каталоге `plugins/echo-panel.html` содержится пример мини-приложения, которое отправляет действия `send.echo` и отображает контекст комнаты. Плагин `plugins/echo-bot.js` обрабатывает событие `ui.action` и отвечает через `ctx.ui.render`.

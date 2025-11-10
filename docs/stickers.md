# Стикер-паки и кастомные эмодзи

Этот документ описывает реализацию загрузки и управления стикер-паками в Matrix Messenger, а также особенности работы с кастомными эмодзи.

## Источники паков

Клиент объединяет несколько источников стикеров в общую библиотеку:

- **Локальные пакеты** (`source: "local"`). Поставляются вместе с приложением и регистрируются через `registerLocalStickerPacks`. Пример набора расположен в `src/assets/stickers.ts`.
- **Паки homeserver'а** (`source: "room"`). Загружаются из событий состояния `m.stickerpack`/`org.matrix.msc2545.stickerpack` комнат, в которых состоит пользователь.
- **Пользовательские паки** (`source: "account_data"` или `"user"`). Синхронизируются из account data текущего профиля. Они обычно содержат кастомные эмодзи и личные наборы.

Все наборы нормализуются в `matrixService` и получают глобальный идентификатор (`StickerPack.id`) с префиксом источника (`room:<roomId>:<stateKey>`, `account:<stateKey>`, и т. д.). Каждая карточка стикера автоматически помечается `packId` и признаком `isCustomEmoji`, если это emoji-пак.

## Жизненный цикл синхронизации

1. Во время запуска клиента `bindStickerPackWatcher` (см. `src/services/matrixService.ts`) подписывается на:
   - `ClientEvent.AccountData` — для обработки account data `m.stickerpack`.
   - `ClientEvent.Room` и `RoomEvent.State` — для наблюдения за комнатными событиями `m.stickerpack`.
2. Все события прогоняются через `buildStickerPackFromContent`, который конвертирует Matrix-представление в структуру `StickerPack`. MXC-ссылки преобразуются в HTTP при помощи `mxcToHttp`.
3. Результат кэшируется в памяти (`stickerPackCache`), а активные наборы сохраняются в `localStorage` под ключом `econix.stickers.enabled`. Состояние библиотеки транслируется подписчикам `subscribeStickerLibrary`.
4. При выходе из комнаты или получении пустого набора (с флагом `enabled: false`) pack удаляется из кэша вместе с избранными элементами.

## Быстрое подключение и отключение паков

Виджет `StickerGifPicker` использует `setStickerPackEnabled(packId, enabled)` для мгновенного добавления или скрытия наборов. Активные идентификаторы синхронизируются между сессиями и применяются к любому источнику, кроме локального (они всегда доступны).

## Избранные стикеры

Функция `toggleStickerFavorite(packId, stickerId)` управляет избранными стикерами и сохраняет их в `localStorage` (`econix.stickers.favorites`). Псевдо-пак «Favorites» формируется динамически, позволяя быстро отправлять закреплённые элементы из любого источника.

## Кастомные эмодзи

Если стикер помечен как `isCustomEmoji`, клиент не отправляет событие `m.sticker`, а вставляет выбранный `shortcode` (или `body`) непосредственно в поле ввода. Для совместимости в `ChatPage` добавлена защита: при получении таких стикеров функция `handleSendSticker` преобразует их в обычное текстовое сообщение.

## API кратко

| Функция | Описание |
| --- | --- |
| `registerLocalStickerPacks(packs)` | Регистрирует встроенные наборы (вызывается один раз при старте UI). |
| `subscribeStickerLibrary(listener)` | Позволяет реагировать на изменения библиотек паков и избранных стикеров. |
| `getStickerLibraryState()` | Возвращает текущее состояние кэша (`packs`, `favorites`, `enabledPackIds`). |
| `setStickerPackEnabled(packId, enabled)` | Включает или выключает конкретный набор. |
| `toggleStickerFavorite(packId, stickerId)` | Добавляет или удаляет стикер из избранного. |
| `bindStickerPackWatcher(client)` | Подключает синхронизацию паков к `MatrixClient`. |
| `sendStickerMessage(...)` | Отправляет событие `m.sticker`, корректно обрабатывая произвольные MIME. |

Дополнительные детали и примеры использования см. в коде `src/services/matrixService.ts` и `src/components/StickerGifPicker.tsx`.

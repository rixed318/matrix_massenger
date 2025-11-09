# Matrix Server Auto-Deployment Guide

## Обзор

Ваш Matrix Messenger теперь поддерживает автоматическое развертывание Matrix Synapse сервера!

Это позволяет вам:
- ✅ Развернуть полноценный Matrix сервер за 5-10 минут
- ✅ Автоматически настроить Nginx, firewall и SSL
- ✅ Создать администратора и сразу подключиться
- ✅ Получить полный контроль над своими данными

## Требования к серверу

### Минимальные требования:
- **ОС**: Ubuntu 20.04/22.04 или Debian 11/12
- **RAM**: минимум 2GB (рекомендуется 4GB+)
- **CPU**: 1-2 ядра
- **Диск**: минимум 20GB свободного места
- **Сеть**: Публичный IP адрес
- **SSH доступ**: root или sudo пользователь

### Рекомендуемые провайдеры:
- DigitalOcean (от $6/месяц)
- Hetzner Cloud (от €4/месяц)
- AWS EC2 (от $5/месяц)
- Vultr (от $5/месяц)

## Как использовать

### 1. Подготовка сервера

Создайте новый VPS сервер у любого провайдера и получите:
- IP адрес сервера (например: 192.168.1.100)
- SSH логин (обычно `root`)
- SSH пароль

### 2. Запуск развертывания

1. Откройте Matrix Messenger
2. На экране входа нажмите кнопку **"Deploy New Server"**
3. Заполните форму:
   - **Server IP**: ваш публичный IP
   - **SSH Username**: root (или ваш sudo пользователь)
   - **SSH Password**: ваш SSH пароль
   - **Domain** (опционально): если у вас есть домен (например: matrix.example.com)
   - **Admin Username**: имя администратора Matrix
   - **Admin Password**: пароль администратора

4. Нажмите **"Test Connection"** для проверки SSH
5. Если тест успешен, нажмите **"Start Deployment"**

### 3. Процесс развертывания

Автоматически будут выполнены следующие шаги:

1. ✓ Подключение по SSH
2. ✓ Обновление системы
3. ✓ Установка зависимостей
4. ✓ Добавление репозитория Matrix.org
5. ✓ Установка Matrix Synapse
6. ✓ Настройка конфигурации
7. ✓ Установка и настройка Nginx
8. ✓ Создание администратора
9. ✓ Настройка firewall
10. ✓ Проверка установки

Весь процесс займет **5-10 минут**.

### 4. После развертывания

После успешного развертывания вы:
- Автоматически подключитесь к вашему серверу
- Получите homeserver URL (http://your-ip:8008)
- Сможете создавать комнаты и приглашать пользователей

## Настройка SSL (HTTPS)

Если вы указали домен, для настройки SSL сертификата:

1. Подключитесь к серверу по SSH:
   ```bash
   ssh root@your_server_ip
   ```

2. Запустите Certbot:
   ```bash
   sudo certbot --nginx -d matrix.example.com
   ```

3. Следуйте инструкциям Certbot

После этого ваш сервер будет доступен по https://matrix.example.com

## Управление сервером

### Проверка статуса
```bash
sudo systemctl status matrix-synapse
```

### Просмотр логов
```bash
sudo journalctl -u matrix-synapse -f
```

### Перезапуск сервера
```bash
sudo systemctl restart matrix-synapse
```

### Создание нового пользователя
```bash
register_new_matrix_user -c /etc/matrix-synapse/homeserver.yaml http://localhost:8008
```

### Конфигурация
Основной файл конфигурации: `/etc/matrix-synapse/homeserver.yaml`

После изменений перезапустите сервер:
```bash
sudo systemctl restart matrix-synapse
```

## Troubleshooting

### Ошибка подключения SSH

**Проблема**: "Failed to connect to server"

**Решение**:
- Проверьте правильность IP адреса
- Убедитесь, что порт 22 открыт в firewall
- Проверьте логин и пароль
- Попробуйте подключиться вручную: `ssh root@your_ip`

### Ошибка установки

**Проблема**: "Installation failed"

**Решение**:
- Убедитесь, что у пользователя есть sudo права
- Проверьте, что на сервере Ubuntu/Debian
- Проверьте свободное место: `df -h`
- Проверьте логи установки

### Сервер не отвечает

**Проблема**: Synapse установлен, но недоступен

**Решение**:
```bash
# Проверить статус
sudo systemctl status matrix-synapse

# Проверить порты
sudo netstat -tlnp | grep 8008

# Проверить логи
sudo journalctl -u matrix-synapse -n 100
```

## Публикация десктопных приложений

Matrix Messenger использует Tauri, поэтому подготовка релизов для Windows, macOS и Linux выполняется одинаковыми шагами с небольшими платформенными нюансами.

### Общая подготовка

1. Убедитесь, что `npm run build` собрал фронтенд, а `tauri.conf.json` содержит актуальный `version`.
2. Настройте источник автообновлений: в `src-tauri/tauri.conf.json` обновите поле `app.updater.endpoints` на ваш CDN или GitHub Releases и сохраните публичный ключ (`pubkey`).
3. Сгенерируйте ключ подписи Tauri (`tauri signer generate`) и сохраните путь в переменной `TAURI_PRIVATE_KEY` перед сборкой.
4. Выполните `npm run tauri build` — будут собраны дистрибутивы для текущей ОС.

### Windows

- Для публикации в Microsoft Store создайте `.appx` через `npm run tauri build -- --target msix`. Не забудьте указать `certificateThumbprint` в `tauri.conf.json`.
- Для самостоятельной публикации распространяйте `.msi`/`.exe` из папки `src-tauri/target/release/bundle`. Подписывайте их через `signtool` и добавляйте публичный ключ автообновлений в `tauri.conf.json`.
- Настройте канал обновлений — загрузите файл `latest.json` и установочные пакеты на HTTPS-хостинг.

### macOS

- Соберите `.dmg` и `.app` пакеты (появятся в `bundle/macos`).
- Подпишите приложение через `codesign` и notarize через `xcrun notarytool`. Укажите bundle ID `com.matrix.messenger.dev` либо свой в `tauri.conf.json`.
- Для публикации в Mac App Store используйте `--target app` и подготовьте `.pkg`, затем загрузите через Transporter.
- Разместите файл обновлений `latest-macos.json` и соответствующие `.dmg` на CDN.

### Linux

- В результате сборки вы получите `.AppImage`, `.deb`, `.rpm` и архивы.
- Подпишите пакеты (например, `gpg --detach-sign matrix-messenger_0.1.0_amd64.deb`).
- Опубликуйте артефакты на сайте/репозитории; обновите `latest-linux.json` для автообновлений.
- Для дистрибуции через Snapcraft используйте `tauri build --target snap` и загрузите снап в Snap Store.

## Публикация мобильного приложения

Expo-проект находится в папке `mobile/` и использует общие сервисы из `packages/core`.

### Подготовка

1. Установите Expo CLI (`npm install -g expo-cli`) и выполните `npm install` в корне репозитория.
2. Убедитесь, что `mobile/app.config.ts` содержит актуальные идентификаторы пакетов и ссылку на ваш Matrix homeserver.
3. Авторизуйтесь в Expo (`npx expo login`).

### Android (Google Play)

1. Выполните `cd mobile && npx expo prebuild --platform android` для генерации нативного проекта.
2. Запустите `npx expo run:android --variant release` или используйте EAS Build (`eas build -p android`).
3. Полученный `.aab` подпишите (если сборка локальная) и загрузите в Google Play Console.
4. Настройте over-the-air обновления через `eas update` или отключите их, если полагаетесь на автодеплой через магазин.

### iOS (App Store)

1. Выполните `cd mobile && npx expo prebuild --platform ios`.
2. Соберите архив Xcode (`npx expo run:ios --scheme matrixmessenger --configuration Release`) либо используйте `eas build -p ios`.
3. Подпишите приложение с помощью сертификатов Apple Developer и загрузите через Transporter/App Store Connect.
4. Добавьте push capability для нотификаций и настройте App Groups, если планируется share-расширение.

### OTA-обновления Expo

- Укажите `updates.url` в `app.config.ts` на ваш EAS проект.
- Запускайте `eas update --branch production --message "Описание обновления"`, чтобы доставить обновление без публикации в магазинах.
- Следите за совместимостью с Tauri core: общие API находятся в `packages/core`, изменения требуют синхронизации версий десктопного и мобильного клиента.

### Проблемы с федерацией

**Проблема**: Не могу общаться с пользователями других серверов

**Решение**:
- Убедитесь, что порт 8448 открыт
- Настройте делегирование домена (.well-known)
- Проверьте DNS записи

## Безопасность

### Рекомендации:

1. **Смените SSH пароль** после установки:
   ```bash
   passwd
   ```

2. **Настройте SSH ключи** вместо паролей:
   ```bash
   ssh-keygen -t ed25519
   ssh-copy-id root@your_server_ip
   ```

3. **Отключите вход по паролю** в SSH:
   ```bash
   sudo nano /etc/ssh/sshd_config
   # Установите: PasswordAuthentication no
   sudo systemctl restart sshd
   ```

4. **Настройте fail2ban**:
   ```bash
   sudo apt install fail2ban
   sudo systemctl enable fail2ban
   ```

5. **Регулярно обновляйте систему**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

## Резервное копирование

### База данных
```bash
# Создать backup
sudo -u postgres pg_dump synapse > synapse_backup.sql

# Восстановить
sudo -u postgres psql synapse < synapse_backup.sql
```

### Медиа файлы
```bash
# Backup
sudo tar -czf media_backup.tar.gz /var/lib/matrix-synapse/media

# Restore
sudo tar -xzf media_backup.tar.gz -C /
```

### Конфигурация
```bash
# Backup
sudo cp /etc/matrix-synapse/homeserver.yaml ~/homeserver_backup.yaml
```

## Производительность

### Для больших серверов

1. **Используйте PostgreSQL** вместо SQLite:
   ```bash
   sudo apt install postgresql postgresql-contrib
   ```

2. **Настройте Redis** для кэширования:
   ```bash
   sudo apt install redis-server
   ```

3. **Увеличьте ресурсы** в `/etc/matrix-synapse/homeserver.yaml`:
   ```yaml
   database:
     name: psycopg2
     args:
       user: synapse_user
       password: secretpassword
       database: synapse
       host: localhost
       cp_min: 5
       cp_max: 10
   ```

## Полезные ссылки

- [Официальная документация Synapse](https://matrix-org.github.io/synapse/latest/)
- [Matrix.org](https://matrix.org/)
- [Сообщество Matrix](https://matrix.to/#/#matrix:matrix.org)
- [Troubleshooting Guide](https://github.com/matrix-org/synapse/blob/develop/docs/usage/administration/troubleshooting.md)

## Поддержка

Если у вас возникли проблемы:
1. Проверьте этот guide
2. Посмотрите логи сервера
3. Проверьте официальную документацию Matrix
4. Создайте issue в репозитории проекта

---

**Важно**: Автоматическая установка предназначена для быстрого развертывания. Для production использования рекомендуется дополнительная настройка безопасности, мониторинга и резервного копирования.

# Сервер комнаты: ymsync-relay в Docker на Debian

Гайд для случая, когда вы с друзьями в разных сетях и хотите слушать вместе.
Комнату держит не чей-то компьютер, а сервер в интернете. Все подключаются к
нему из Яндекс Музыки Sync, и у всех синхронно играют очередь, позиция, пауза,
переключения и «Моя волна».

```
 ваша Яндекс Музыка Sync ──┐                ┌── Яндекс Музыка Sync друга
                           └──► VDS: relay ◄┘
          звук каждый получает сам — со своего аккаунта Яндекса
```

Через сервер идут только короткие команды и метки времени, звук через него не
идёт. Поэтому подойдёт самый простой VDS: релей занимает несколько мегабайт
памяти и почти не использует процессор. Берите сервер, до которого у всех
участников маленький пинг: если задержка больше 400 мс, клиенты перестают
подстраивать позицию.

> **У каждого участника должен быть свой аккаунт Яндекс Музыки с Плюсом.**
> Каждый слушает трек со своего аккаунта.

| | Через сервер |
|---|---|
| Общая очередь, пауза, перемотка, переключение — командует любой | да |
| «Моя волна» | да: волна того, кто её включил. Если он выйдет, волну подхватит оставшийся |
| Повтор, перемешивание, «играть следующим», список участников | да |
| Старт трека одновременно у всех | да: релей ждёт до 15 с, пока трек загрузится у каждого |

---

## 1. Подготовка сервера

Подойдёт Debian 12 (bookworm) или 13 (trixie); на Ubuntu команды те же. Все
команды выполняются от root или через `sudo`.

```bash
apt-get update
apt-get install -y ca-certificates curl git openssl
```

### Docker из официального репозитория

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker run --rm hello-world     # проверка
```

Если `docker pull` падает на скачивании образов с Docker Hub (у некоторых
российских хостеров бывает именно так), подключите зеркало:

```bash
cat > /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://mirror.gcr.io"] }
EOF
systemctl restart docker
```

## 2. Код на сервер

```bash
git clone https://github.com/ComboGame/YaMod-Sync.git /opt/yamod-sync
cd /opt/yamod-sync
```

Без git можно скопировать нужные файлы с компьютера (в PowerShell, из папки
репозитория), предварительно создав папку на сервере: `mkdir -p /opt/yamod-sync`.

```powershell
scp -r Cargo.toml Cargo.lock Dockerfile .dockerignore docker-compose.yml .env.example crates deploy root@IP_СЕРВЕРА:/opt/yamod-sync/
```

## 3. Пароль комнаты

```bash
cd /opt/yamod-sync
cp .env.example .env
sed -i "s/^YMSYNC_ROOM_TOKEN=.*/YMSYNC_ROOM_TOKEN=$(openssl rand -hex 16)/" .env
chmod 600 .env
cat .env      # запомните значение YMSYNC_ROOM_TOKEN: это пароль комнаты
```

## 4А. Запуск: просто IP и порт (`ws://`)

```bash
docker compose up -d --build
```

Первая сборка занимает несколько минут: компилируется Rust. Проверка:

```bash
docker compose ps          # STATUS: Up … (healthy)
docker compose logs -f relay
```

В логе должна появиться строка `relay listening bind=0.0.0.0:8787 protocol=6 lan_share=false`.

Откройте **TCP 8787** во входящих. Если у хостера есть файрвол в панели,
откройте порт там.

> Docker публикует порты в обход `ufw`: правило `ufw deny 8787` контейнер не
> закроет. Чтобы ограничить доступ, используйте файрвол в панели хостера.

Адрес сервера для приложения: **`ws://IP_СЕРВЕРА:8787`**

## 4Б. Запуск: домен и TLS (`wss://`)

Пароль комнаты при `ws://` уходит открытым текстом. Если есть домен, лучше
закрыть соединение TLS: Caddy сам получит и будет продлевать сертификат
Let's Encrypt.

1. Направьте A-запись домена (например, `music.example.com`) на IP сервера.
2. Откройте **TCP 80 и 443**. Порт 8787 наружу больше не нужен.
3. Допишите в `.env`:

   ```bash
   YMSYNC_DOMAIN=music.example.com
   RELAY_PUBLISH=127.0.0.1:8787
   ```

4. Запустите:

   ```bash
   docker compose --profile tls up -d --build
   docker compose logs -f caddy     # дождитесь "certificate obtained successfully"
   ```

Адрес сервера для приложения: **`wss://music.example.com`**

## 4В. Запуск: за уже настроенным nginx

Если на сервере уже работает nginx с HTTPS, Caddy не нужен: он не сможет
занять порты 80 и 443. Релей слушает только localhost, а nginx проксирует
к нему WebSocket по пути `/ymsync`.

1. Допишите в `.env`:

   ```bash
   RELAY_PUBLISH=127.0.0.1:8787
   ```

2. Запустите только релей, без `--profile tls`:

   ```bash
   docker compose up -d --build
   ```

3. Вставьте блок из [deploy/nginx-ymsync.conf](../deploy/nginx-ymsync.conf)
   внутрь `server { … }` вашего домена, того, где `listen 443 ssl`.
   Затем проверьте конфиг и перечитайте его:

   ```bash
   nginx -t && systemctl reload nginx
   ```

Адрес сервера для приложения: **`wss://ваш.домен/ymsync`**

Если nginx сам работает в контейнере, `127.0.0.1` из него указывает на сам
контейнер nginx. В этом случае подключите nginx к сети релея
(`docker network connect yamod-sync_default <контейнер nginx>`; имя сети покажет
`docker network ls`) и пишите в `proxy_pass` `http://relay:8787`.

## 5. Подключение из приложения

Каждый участник:

1. Устанавливает Яндекс Музыку Sync из
   [Releases](https://github.com/ComboGame/YaMod-Sync/releases) и входит в свой
   аккаунт Яндекса с Плюсом.
2. Нажимает кнопку **Sync** рядом с профилем и на вкладке **«Комната»**
   заполняет:
   - **адрес сервера**: `ws://IP_СЕРВЕРА:8787` или `wss://ваш.домен`;
   - **комната**: любое название, например `home`, одинаковое у всех;
   - **пароль**: значение `YMSYNC_ROOM_TOKEN` из `.env`.
3. Нажимает **«Войти в комнату»**. Переключатель «Держать комнату на этом
   компьютере» должен быть выключен: он поднимает комнату на своём компьютере
   вместо сервера.

В списке участников должны появиться все. Теперь кто угодно ставит трек,
альбом, плейлист или «Мою волну», и у остальных заиграет то же самое с той же
позиции.

## Обслуживание

```bash
cd /opt/yamod-sync

docker compose logs -f relay                 # логи
docker compose restart relay                 # перезапуск
docker compose down                          # остановить (добавьте --profile tls, если был TLS)

git pull && docker compose up -d --build     # обновить (с TLS: --profile tls)
```

Контейнер с `restart: unless-stopped` сам поднимается после перезагрузки
сервера. Перезапуск релея сбрасывает очередь комнаты: клиенты переподключатся
сами, но очередь придётся поставить заново. Пустая комната хранит очередь
12 часов.

Подробные логи: добавьте `RUST_LOG=ymsync_relay=debug` в `.env` и выполните
`docker compose up -d`.

Сменить пароль: исправьте `YMSYNC_ROOM_TOKEN` в `.env`, выполните
`docker compose up -d` и впишите новый пароль в приложении у всех.

## Если что-то не так

| Симптом | Причина |
|---|---|
| Приложение не подключается, в логе релея пусто | Порт закрыт: файрвол хостера или для `wss` нет 80/443. Проверьте с компьютера: `Test-NetConnection IP -Port 8787` |
| `bad room token` / `unauthorized` | Пароль в приложении не совпадает с `YMSYNC_ROOM_TOKEN` |
| `relay speaks protocol 6, client speaks N` | Разные версии приложения у участников: обновитесь из Releases |
| У одного играет, у другого тишина и «трек недоступен» | У второго аккаунт без Плюса или трек недоступен в его регионе |
| Постоянно перематывает | Большой пинг до сервера (> 400 мс) или нестабильная сеть. Возьмите сервер ближе |
| `wss://` не подключается, `ws://` работает | Caddy ещё не получил сертификат (смотрите `docker compose logs caddy`), или A-запись указывает не на этот сервер |

## Без Docker

Тот же релей можно запустить напрямую (нужен Rust 1.90+):

```bash
cargo build --release --locked -p ymsync-relay
YMSYNC_ROOM_TOKEN=секрет ./target/release/ymsync-relay \
  --bind 0.0.0.0:8787 --no-discovery --no-lan-share
```

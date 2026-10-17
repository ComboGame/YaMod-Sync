# CLAUDE.md

Справочник по проекту для будущих сессий. Коротко и по делу; подробности — в коде.

## Что это

Яндекс Музыка Sync: официальный десктопный клиент Яндекс Музыки для Windows,
пропатченный при сборке, со встроенным совместным прослушиванием. Участники
заходят в «комнату» на сервере `ymsync-relay` и слушают одно и то же с одной
позиции, каждый со своего аккаунта с Плюсом. Мод не открывает платное и не
скачивает треки.

## Структура

```
crates/
  proto/    протокол 6 (message.rs), часы (clock.rs), коррекция decide() (sync.rs)
  relay/    ymsync-relay: комнаты, очередь, якорь позиции, барьер готовности, станция
  core/     библиотека ymsync: API Яндекса (api.rs), связь с релеем (link.rs),
            движок (engine.rs), сессия (session.rs), Playback-трейт (playback.rs)
  bridge/   ymsync-bridge.exe: ядро для плеера в другом процессе; RemotePlayback (remote.rs),
            протокол со строками JSON по stdio (protocol.rs), супервизор сессии (lib.rs)
mod/
  src/patcher/                 скачивание сборки Яндекса, правки index.js/preload.js/HTML, упаковка
  src/mod/main.ts, main/       main-процесс: настройки (storage), блок аналитики, Discord RPC,
                               запуск моста и IPC (yandex-sync.ts)
  src/mod/preload.ts           дописывается в preload.js клиента; window.yandexMusicMod
  src/mod/renderer.ts          вход renderer-части (инжектится <script> в каждую HTML-страницу)
  src/mod/features/yandex-sync/  sonata.ts (фасад плеера), controller.ts (связка с мостом), index.ts
  src/mod/features/ui/         React-панель Sync (App.tsx, components/sync, components/ui — shadcn)
  src/mod/features/*           прочие функции: auto-best-quality, font-changer, devtools, discord-RPC
  scripts/debug-copy-ui.js     `bun run ui:dev`
deploy/, Dockerfile, docker-compose.yml, docs/server.md   развёртывание релея
.github/workflows/ci.yml       Rust-тесты + Docker-образ релея (Linux)
.github/workflows/release.yml  установщик на Windows, релиз mod-v<mod/VERSION>
```

## Команды

```bash
cargo test --workspace                  # 260+ тестов, включая сквозной тест моста (crates/bridge/tests)
cargo build --release -p ymsync-relay   # сервер
```

```powershell
cd mod
bun install                             # Bun 1.1.27 (им записан bun.lockb)
bun run start                           # скачать Яндекс Музыку, пропатчить, собрать мост и установщик
bun run dev                             # то же без установщика → .versions/<v>/mod
bun run ui:dev                          # пересобрать renderer/main/preload в уже подготовленной папке
# запуск dev-папки (переменная ELECTRON_RUN_AS_NODE из терминала VS Code должна быть снята):
node_modules/electron/dist/electron.exe .versions/<v>/mod --remote-debugging-port=9333
```

- Установщик: `mod/.versions/<v>/mod/dist/YandexMusicSync-Setup-<v>.exe`.
- Мост патчер собирает из `../crates/bridge` (`YMSYNC_REPO` — другой путь, `YMSYNC_BRIDGE` — готовый exe).
- Без доступа к GitHub-релизам: `ELECTRON_MIRROR`, `ELECTRON_BUILDER_BINARIES_MIRROR` (npmmirror).
- Линта, тестов и проверки типов для TS нет. TypeScript только в peerDependencies, а `bunx tsc` тянет
  последнюю версию, где `baseUrl` из `tsconfig.json` уже удалён; `include: ./**/*` захватывает и `.versions`.
  Проверять свои файлы — временным tsconfig (extends `mod/tsconfig.json`, узкий `include`, `typeRoots`
  на `mod/node_modules/@types`) и TypeScript 5: `bunx -p typescript@5 tsc -p <temp>.json`.
- `PRETTIFY=true` — прогнать prettier по пропатченной сборке (медленно).

## Синхрон

- Источник истины — релей. Клиент шлёт `do {command}`, релей применяет и рассылает всем
  (включая отправителя) `state`/`queue`. Ролей нет, командовать может любой.
- Протокол 6 (`proto/src/message.rs`): клиент → `hello`, `time_req`, `do`, `ready`, `share`, `set_name`, `bye`;
  релей → `welcome`, `time_res`, `state`, `queue`, `roster`, `peer`, `station`, `shares`, `error`.
- Позиция — якорь `position_ms` на момент `at_server_ms` (часы релея); `target_position_ms()` экстраполирует.
- Новый трек ждёт `ready` от всех (`READY_TIMEOUT_MS` 15 с), старт с запасом `START_LEAD_MS` 300 мс.
  Пустая комната замораживает позицию и живёт 12 ч.
- Коррекция (`proto::decide`): только seek, порог 300 мс, опережение 40 мс, cooldown 2 с (`engine::SEEK_COOLDOWN`).
  `Resume` (комната играет, плеер стоит) всегда делает seek + play.
- Станция («Моя волна»): её «кормит» участник, который её включил (`feeding`), батчами по мере
  приближения к концу очереди (`STATION_LEAD` 2). Ушёл — `station_unfed`, подхватывает любой со своего аккаунта.
  Волна идёт через `rotor/session/new|tracks|feedback`, события radioStarted/trackStarted/trackFinished/skip
  (`core/src/api.rs`, `engine.rs::WaveSession`); при ошибке — старый `rotor/station/.../tracks`.

### Мост ↔ мод (`crates/bridge/src/protocol.rs`)

- Мод → мост: `start {config}`, `stop`, `quit`, `command {command: {c: ...}}`, `player {state}` (каждые 200 мс),
  `loaded {result}`.
- Мост → мод: `status {state: stopped|connecting|connected|reconnecting, error?}`, `snapshot` (≤4/с, сразу при
  смене очереди), `player {op: load|play|pause|seek}`.
- `RemotePlayback::load` ждёт `loaded` до 15 с; позиция экстраполируется между отчётами (не дольше 2 с).
- Повторный `start` с той же конфигурацией (перезагруженное окно) → заново `connected`, снапшот и `load`.
- IPC: `yandexSync.start|stop` (invoke), `yandexSync.command|player|loaded` (send), события `yandexSync.event`.
  Настройки мода — `yandexMusicMod.get/setStorageValue`, файл `userData/mod_settings.json`.

## Привязка к клиенту Яндекс Музыки (хрупкое)

Всё ниже ломается при обновлении клиента; проверять на каждой новой версии.

- Патчер (`patcher.ts`) ищет в `index.js` точные строки: `UPDATE_POLL_INTERVAL_MS:`, `REFRESH_EVENT_TRIGGER_TIME_MS:`,
  `PRODUCT_NAME_LOCALIZED:`, `    updater.start();`, `minWidth: 768`, `minHeight: 650`, `titleBarStyle: "hidden",`.
  Несовпадение = падение сборки (так задумано).
- Electron зафиксирован 38.2.2 (как у клиента 5.122). В asar есть приватный `@yandex-music-int/...` — не ставить
  зависимости клиента через npm, node_modules берутся из asar.
- Фасад плеера Sonata (`sonata.ts::player`): объект в `memoizedState` хука с `playbackController`, `setContext`,
  `setProgress`, `getState`. Используются `setContext`, `setEntityByIndex`, `setProgress(сек)`, `play`, `resume`,
  `pause`, `getState().playerState.{status,progress}`, `queueState.{currentEntity,entityList,index}`,
  `currentContext`. Треки ставятся как `{type:"unloaded", meta:{id}}` в контексте `various` с id `ymsync-room-<rev>`.
- Позиция Sonata обновляется раз в ~265 мс → `progress.onChange` + досчёт (`livePositionMs`).
- Действия пользователя ловятся перехватом методов фасада (`controller.ts::INTERCEPTS`); свои вызовы — в `asMod()`
  (флаг только на синхронную часть вызова). Аргумент «id воспроизведения» = трейлер/клип, не трогать.
- `playContext` с `contextData.type === "vibe"` в комнате блокируется и превращается в волну комнаты.
- Токен — `localStorage.oauth`. DOM: `section[data-test-id="PLAYERBAR_DESKTOP"]`,
  `div[class*="NavbarDesktopUserWidget_userProfileContainer"]`.
- Пока в комнате, фоновый троттлинг окна выключен (`webContents.setBackgroundThrottling(false)`), иначе
  таймеры свёрнутого окна почти встают и синхрон разваливается.

## Стиль

- Rust: комментарии и doc-комментарии по-английски, объясняют «почему»; сообщения пользователю по-русски.
  Тест на каждое поведение, имена тестов — предложения (`a_late_answer_for_an_old_track_is_ignored`).
- Мод: комментарии по-русски, строгий TS, `neverthrow` в API-хелперах, `import type` для типов
  (Vite/rolldown иначе падает). UI — shadcn/Radix + Tailwind 4, токены цвета через `var(--ym-*)` клиента.
- Тексты интерфейса — по-русски, предложениями, без капса.
- Коммиты: короткий заголовок по-английски, как в истории репозитория.

## Известные проблемы и грабли

- Обрывы звука при синхроне: seek-only коррекция и `Resume` с seek рассчитаны на трек в памяти, а у Sonata
  каждый seek — перебуферизация; буферизация отчитывается как `playing`; смена трека через
  pause→setEntityByIndex→pause→setProgress(0) + барьер.
- Пресеты волны (seeds) теряются — любой `vibe` становится `user:onyourwave`; like/dislike в сессию волны не идут.
- Стили мода не изолированы: Tailwind preflight и `* { border-border; outline-ring }` глобальные,
  `ThemeContext` вешает `dark`/`light` на `<html>`.
- В сборке остаётся отладочный `window.__yandexSync` (+ `stats`).
- Discord RPC опрашивает окно `executeJavaScript` 2 раза/с; ip-checker ходит на `http://ip-api.com`.
- «Ссылка на Мою коллекцию» без предупреждения делает коллекцию публичной.
- Окружение Windows: в Git Bash `/usr/bin/link` перекрывает MSVC `link.exe` — cargo собирать из PowerShell.
  Bun 1.1.27 не умеет `format: "cjs"` в `Bun.build` → main/preload собираются esbuild. Vite держать на 7.x.

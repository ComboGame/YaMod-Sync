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
  android/  ymsync-android (cdylib): JNI для телефона (ffi.rs), сессия с супервизором и своей комнатой (session.rs)
android/                       приложение для Android (Kotlin, Compose, Media3), docs/android.md
mod/
  src/patcher/                 скачивание сборки Яндекса, правки index.js/preload.js/HTML, упаковка
  src/mod/main.ts, main/       main-процесс: настройки (storage), блок аналитики, Discord RPC,
                               запуск моста и IPC (yandex-sync.ts)
  src/mod/preload.ts           дописывается в preload.js клиента; window.yandexMusicMod
  src/mod/renderer.ts          вход renderer-части (инжектится <script> в каждую HTML-страницу)
  src/mod/features/yandex-sync/  sonata.ts (фасад плеера), controller.ts (связка с мостом), index.ts
  src/mod/features/ui/         интерфейс мода: App.tsx; theme/ — оформление клиента (modrinth.css);
                               shell/ — верхняя панель, колонка «Комната», кнопки в сайдбаре, настройки;
                               components/sync, components/ui (shadcn)
  src/mod/features/*           прочие функции: auto-best-quality, font-changer, devtools, discord-RPC
  scripts/debug-copy-ui.js     `bun run ui:dev`
deploy/, Dockerfile, docker-compose.yml, docs/server.md   развёртывание релея
.github/workflows/ci.yml       Rust-тесты + Docker-образ релея (Linux)
.github/workflows/release.yml  установщик на Windows, релиз mod-v<mod/VERSION>
.github/workflows/android-release.yml  APK, релиз android-v<versionName> (только push в main, не «latest»)
```

## Команды

```bash
cargo test --workspace                  # ~310 тестов; в crates/bridge/tests — симулятор приложения
                                        # (sim::App) и подставной API Яндекса (fake_yandex) для волны
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
  на `mod/node_modules/@types`) и TypeScript 5: `npx -y -p typescript@5.9.3 tsc -p <temp>.json`
  (`bunx` 1.1.27 портит аргументы `-p`).
- На этой машине стабильный cargo старый (1.76, не понимает `resolver = "3"`): `cargo +1.99.1 …`, для патчера —
  `$env:RUSTUP_TOOLCHAIN="1.99.1"`.
- Отладка из devtools/CDP: `window.__yandexSync` (`connect`, `command`, `getSyncState`, `snapshot`, `player`,
  `stats` — сколько указаний отклонено как «для другого трека», загрузок отменено, очередей обновлено на месте).
  UI — в shadow-корнях: `#yandex-music-sync-root` (настройки, тосты), `#mod-sheet-container` (кнопки в сайдбаре),
  `#ymsync-topbar`, `#ymsync-dock`. Лог моста подробнее: `RUST_LOG=ymsync=debug` (замеры часов, загрузок,
  ответов релея, отправленный фидбек волны). Переход по разделам из CDP — `window.next.router.push(url)`
  (кроме `/landing`: там перезагрузка), меню профиля — iframe Яндекс ID (отдельная CDP-цель).
- `PRETTIFY=true` — прогнать prettier по пропатченной сборке (медленно).

Android (`android/`, `crates/android/`; план — `docs/superpowers/plans/2026-10-18-android-app.md`):
- SDK — `%LOCALAPPDATA%\Android\Sdk` (`ANDROID_HOME`), NDK 30.0.16248370 (`ANDROID_NDK_HOME`), платформы 36 и 37.0,
  build-tools 37.0.0, AVD `ymsync-test` (Android 16, x86_64). Пакеты ставит `cmdline-tools\latest\bin\android.exe sdk
  install <пакет>` (`sdkmanager` в новых cmdline-tools заменён «Android CLI»).
- Rust-таргеты Android — в тулчейне 1.99.1; `cargo-ndk` 4.x. `adb` — из `%ANDROID_HOME%\platform-tools` (в `C:\adb`
  лежит старый).
- Сборка (PowerShell; `JAVA_HOME` — JDK 17+, на машине Zulu 21):
  ```powershell
  cargo +1.99.1 ndk -t arm64-v8a -t armeabi-v7a -t x86_64 --platform 26 -o crates/android/jniLibs build --release -p ymsync-android
  cd android; .\gradlew.bat testDebugUnitTest assembleDebug     # APK: app/build/outputs/apk/debug/app-debug.apk
  & "$env:ANDROID_HOME\emulator\emulator.exe" -avd ymsync-test -no-window -no-audio   # эмулятор без окна
  adb install -r app\build\outputs\apk\debug\app-debug.apk; adb logcat -s ymsync   # лог ядра — тег ymsync
  ```
- AGP 9: Kotlin встроен (плагина `kotlin-android` нет), Compose-компилятор — плагин той же версии, что Kotlin.
  Версии — `android/gradle/libs.versions.toml`, версия приложения — `android/version.properties`.
- Устройство: звук играет плеер самого ядра (`core/src/player.rs`, rodio → AAudio; фичи `audio-rodio`, `tls-rustls`
  только для Android), не ExoPlayer — его отставание позиции давало бесконечные перемотки. Media3 — только
  MediaSession и уведомление: `playback/CorePlayer.kt` (`SimpleBasePlayer` поверх снапшота), `PlaybackService.kt`.
  Без комнаты телефон держит свою невидимую комнату (`room=телефон`, релей на 127.0.0.1). Команды — общий язык
  `ymsync::ui::UiCommand` (мост и телефон); JNI-класс `ru.combogame.yamodsync.core.Native`, ответы `{ok}`/`{error,code}`.
- Снапшот ядра не несёт `queue`, если её ревизия уже отдана: `CoreSession` держит прежнюю. `AppModel` — вход,
  комната, настройки (`settings/AppSettings.kt`, DataStore; пароль комнаты там же), перезапуск сессии при смене
  комнаты, качества, ника. Лайки и фидбек волны — `playback/PlaybackLogic.kt::likeCommands/dislikeCommands`.
- «Вперемешку» в «Мне нравится» перемешивает список на телефоне и потом шлёт `shuffle on`: релей не перемешивает
  `set_queue`, а его shuffle трогает только то, что впереди.
- Debug-витрина без входа: `adb shell am start -n ru.combogame.yamodsync/.debug.ShowcaseActivity -e screen <экран>`
  (`home`, `home-guest`, `collection`, `room`, `room-join`, `player`, `settings`, `room-live` — настоящее ядро и релей
  ПК на `ws://10.0.2.2:8799`). Скриншот — `adb exec-out screencap -p > файл` из Git Bash (PowerShell портит байты).
- Самообновление (`update/`): `api.github.com/.../releases`, тег `android-v*`, файл `YaModSync-*.apk`, SHA-256 из
  `SHA256SUMS.txt` обязателен; установка — сессия `PackageInstaller` + `InstallReceiver`. Ключ подписи —
  `C:\Users\User\YaModSync-keys` (вне репозитория, секреты GitHub — по docs/android.md), локально —
  `android/keystore.properties` (в .gitignore). Debug и release подписаны разными ключами: смена — через удаление.
- Тесты Kotlin — JVM (`app/src/test`), без Robolectric: только чистые функции и модели. DataStore в тестах —
  в памяти: файловый на JVM под Windows не может заменить свой файл при второй записи.
- Material 3 Expressive: `Slider` рисует толстую дорожку с разрывом — у перемотки свои `thumb`/`track`. Тема всегда
  тёмная: `enableEdgeToEdge(SystemBarStyle.dark(...))`, иначе на графите значки статус-бара тусклые.
- Аудиовыход ядра (`core/src/player.rs`): `Sink` подключён к своему микшеру (`SharedOutput`), поток устройства его только
  тянет. Смена маршрута (выключили Bluetooth) убивает поток AAudio (`DeviceNotAvailable`) — `keep_output` открывает новый,
  звук идёт с того же сэмпла. Без этого `Sink::try_seek`/`clear` ждали аудиопоток вечно и вешали синхрон. Плеер создаётся
  на каждый старт сессии: уничтоженный закрывает свой поток (`AudioEvent::Closed`). Тесты плеера — `--features audio-rodio`.
- Наушники отключились или звонок в комнате → громкость 0 только здесь (`FocusController`); это «пауза на телефоне»
  (`playback/PlaybackLogic.kt::mutedHere`, `playingHere`), и любой `Toggle` включает звук, а не ставит паузу всем
  (`toggleCommands`, перехват в `CoreSession.command`).
- WebView входа (`auth/LoginScreen.kt`) — с `layoutParams` MATCH_PARENT: с WRAP_CONTENT от `AndroidView` в нём
  `100vh` = 0, и выезжающие меню Яндекса ID (повторная отправка кода) оказываются над экраном. Отладка страницы —
  debug-сборка, `adb forward tcp:9339 localabstract:webview_devtools_remote_<pid>` и CDP на этом порту.

## Синхрон

- Источник истины — релей. Клиент шлёт `do {command}`, релей применяет и рассылает всем
  (включая отправителя) `state`/`queue`. Ролей нет, командовать может любой.
- Протокол 6 (`proto/src/message.rs`): клиент → `hello`, `time_req`, `do`, `ready`, `share`, `set_name`, `bye`;
  релей → `welcome`, `time_res`, `state`, `queue`, `roster`, `peer`, `station`, `shares`, `error`.
- Позиция — якорь `position_ms` на момент `at_server_ms` (часы релея); `target_position_ms()` экстраполирует.
- Трек, выбранный кем-то (очередь, «вперёд», номер), ждёт `ready` от всех (`READY_TIMEOUT_MS` 15 с), старт
  с запасом `START_LEAD_MS` 300 мс. Естественный переход (трек доиграл) — без ожидания: следующий трек
  привязан к концу предыдущего плюс `NATURAL_GAP_MS` 450 мс — столько плеер Яндекс Музыки молчит между
  треками, переходя сам (`relay::continue_at`). Пустая комната замораживает позицию и живёт 12 ч.
- Коррекция (`proto::decide_with`): у бэкенда со скоростью (`Playback::supports_rate`, это мост) расхождение
  до 1,5 с закрывается скоростью (`NudgeParams`: мёртвая зона 40 мс, 4 мс на 1‰, максимум ±5%, высота тона
  сохраняется), seek — только дальше 1,5 с; продолжение рядом с комнатой — `Correction::Play` без seek.
  Без скорости — как раньше: seek > 300 мс, опережение 40 мс, cooldown 2 с (`engine::SEEK_COOLDOWN`).
- Барьер на треке, который плеер уже играет сам, не ставит паузу, пока позиция < 2 с (`BARRIER_HEAD_START_MS`);
  фору забирает скорость. Скорость сбрасывается при загрузке трека. Конец трека по длительности Яндекса —
  без паузы для бэкенда со скоростью: файл обычно чуть длиннее, и плеер должен перейти сам.
- Три состояния не путаются: что мост поставил (`staged`), подтвердил ли плеер (`loaded`) и на каком треке
  плеер сейчас (отчёты). Плеер ушёл с трека комнаты (`Playback::lost_track`, дольше 600 мс, только в нашей
  очереди) → трек ставится снова (`engine::recover_track`: 2 с, после трёх раз — 10 с), кроме случая, когда
  плеер уже на следующем треке комнаты за ≤3 с до конца текущего. В плеере нет трека комнаты и ничего не
  грузится → `engine::ensure_staged` (раз в 2 с). Пока плеер не на поставленном треке, ему не шлётся ничего.
- Бэкенд, который сам скачивает трек (`Playback::plays_by_id`, это мост), не ждёт резолва у Яндекса и не
  предзагружает следующий.
- Снапшот: `room_playing` (что хочет комната; null — релей ещё молчит), `local_track`, `local_live` (отчёты
  свежие), `latency {rtt_ms, rtt_last_ms, command_ms, delivery_ms, load_ms, barrier_ms}` — измерено ядром.
- Станция — волна, которую «кормит» включивший её участник (`feeding`) со своего аккаунта, батчами по мере
  приближения к концу очереди (`STATION_LEAD` 2). Строка станции на релее — JSON `StationSpec`
  (`core/src/station.rs`: `seeds`, `name`, `description`, `by`); голый сид от старых версий тоже читается.
  `Command::PlayWave {seeds}` — «Моя волна» (без сидов) или пресет (`genre:rnb`, `artist:…`, `mood:…`,
  `activity:…`, `diversity:…`). Сессия: `rotor/session/new` с сидами и `includeWaveModel` (оттуда название),
  `…/tracks`, `…/feedback`; события radioStarted/trackStarted/trackFinished/skip и like/unlike/dislike/undislike
  (`Command::WaveFeedback`, только от того, кто кормит). При ошибке — старый `rotor/station/<сид>/tracks`.
- Включивший вышел → `station_unfed`: очередь доигрывает, волну никто не подхватывает сам; в снапшоте
  `station_unfed`, в панели — «Продолжить со своего аккаунта» (новый `PlayWave` с теми же сидами).
- `PlayWave` с сидами волны, которую этот участник уже кормит, не открывает новую сессию и не заменяет
  очередь: только продолжает, если комната на паузе (кнопка «Моя волна» в приложении, нажатая ещё раз).
- У каждой станции своё поколение (`Station::generation`): ответ на запрос треков прежней волны (режим
  переключили, пока он шёл) отбрасывается. Иначе пачка старого режима заменяла очередь, а новая дописывалась.
- Волна, которую кормит другой участник и он здесь, — его: `set_queue`, `enqueue`, `play_next`, `index`,
  `shuffle`, новая волна от остальных отклоняются (релей — `station_owned`, ядро — `wave_led_by_another`,
  мод — `controller.ts::waveOwner` + `OWNER_ONLY`, колесо на главной неактивно). Пауза, перемотка, пропуск —
  общие. Ушёл кормящий (`station_unfed`) — волна снова общая.
- Дополнения к протоколу 6 (номер не менялся: всё — необязательные поля и сообщения, старые стороны их
  игнорируют): в `hello` — `client_id` (постоянный id установки, main хранит `sync/clientId`) и `plus`;
  `RosterEntry.{admin, plus, feeds}`; `Command::HandStation{to}`, `Command::SetAdmin{peer}`;
  `ServerMsg::Station.taken`, `ServerMsg::TakeStation{id}`; `ClientMsg::ListRooms{protocol, token}` вместо hello →
  `ServerMsg::Rooms{rooms: [RoomListing]}` и закрытие (старый релей молчит до таймаута hello).
- Админ комнаты (`RoomState::{admin, members}`): первая установка с `client_id`, вошедшая в комнату; узнаётся
  после переподключения по `client_id`; ушёл дольше `ADMIN_GRACE_MS` (10 мин) — права у того, кто дольше всех
  в комнате. Может: `SetStation{None}` для чужой волны, `HandStation` (и кормящий — для своей), `SetAdmin`,
  менять очередь чужой волны (`station_owned` к нему не применяется). Получатель `TakeStation` кормит волну со
  своего аккаунта (`engine::take_station`: очередь не трогается, новая сессия с теми же сидами при подходе к
  концу, в `played` — хвост очереди комнаты); прежний кормящий получает `Station{taken: true}`.
- Плюс: ядро спрашивает `account/status` до подключения (`account_has_plus`, 4 с; не узнали — `None`, считаем
  «есть»). Без Плюса: `PlayWave`/`PlayStation` — отказ (`NEEDS_PLUS`), релей отвечает `needs_plus` на
  `SetStation` и `no_plus` на передачу такому участнику. Слушать волну других можно. Трек, который аккаунт не
  может сыграть, не держит барьер, если в комнате никто ничего не раздаёт (`report_ready`).
- `PlayWave{seeds, fresh}`: `fresh` — новая сессия даже для той же волны («Встряхнуть Мою волну»).

### Мост ↔ мод (`crates/bridge/src/protocol.rs`)

- Мод → мост: `start {config}`, `stop`, `quit`, `command {command: {c: ...}}`, `player {state}` (каждые 200 мс),
  `loaded {result}`. Команды: `toggle`, `next`, `prev`, `seek`, `index`, `set_queue`, `enqueue`, `play_next`,
  `wave {seeds?}`, `stop_wave`, `wave_feedback {kind: like|unlike|dislike|undislike, track_id}`, `repeat`,
  `shuffle`, `name`, `like`.
- Мост → мод: `status {state: stopped|connecting|connected|reconnecting, error?}`, `snapshot` (≤4/с, без
  очереди), `queue {revision, tracks}` (только при изменении), `player {op: load|play|pause|seek|rate}`.
  У play/pause/seek есть `track_id`: мод не выполняет указание для трека, на котором плеер не стоит.
- Отчёт плеера: `{track_id, position_ms, playing, ended, ours}`; `ours` — плеер в очереди комнаты (контекст
  `ymsync-room-…`), а не в том, что пользователь только что включил сам.
- `RemotePlayback::load` ждёт `loaded` до 15 с; позиция экстраполируется между отчётами (не дольше 2 с).
- Повторный `start` с той же конфигурацией (перезагруженное окно) → заново `connected`, очередь, снапшот и
  `load`. Отказ от такого `load` снимает «поставленный» трек, и движок ставит его снова.
- IPC: `yandexSync.start|stop|state|resume|rooms` (invoke; `rooms(relay, password)` — короткое WebSocket-соединение
  из main с `list_rooms`), `yandexSync.command|player|loaded` (send), события `yandexSync.event`. Команды
  моста ещё `hand_wave {to}`, `set_admin {peer}`, у `wave` — `fresh`.
- Обновления мода — `main/updater.ts`: релизы `mod-v*` на GitHub (`ComboGame/YaMod-Sync`, без токена), сравнение
  с `__MOD_VERSION__` (esbuild `define` из `mod/VERSION` в patcher и `ui:dev`), первая проверка через 15 с, потом
  раз в 6 ч. «Обновить» качает установщик в temp, сверяет SHA-256 с `SHA256SUMS.txt` и запускает его, закрыв
  приложение. IPC `modUpdate.state|check|install`, событие `modUpdate.event`; в окне — `ui/hooks/use-update.ts`,
  кнопка в верхней панели, тост один раз на версию (`update/notified`), экран настроек «Обновления» показывает
  раздел «Что нового» из заметок релиза. Main помнит последний статус моста и последний `start`: перезагруженное окно спрашивает
  `state` и делает `resume` (тот же `start` ещё раз) — мост всё это время оставался в комнате.
  Настройки мода — `yandexMusicMod.get/setStorageValue`, файл `userData/mod_settings.json`.

## Привязка к клиенту Яндекс Музыки (хрупкое)

Всё ниже ломается при обновлении клиента; проверять на каждой новой версии.

- Патчер (`patcher.ts`) ищет в `index.js` точные строки: `UPDATE_POLL_INTERVAL_MS:`, `REFRESH_EVENT_TRIGGER_TIME_MS:`,
  `PRODUCT_NAME_LOCALIZED:`, `    updater.start();`, `minWidth: 768`, `minHeight: 650`, `titleBarStyle: "hidden",`.
  Несовпадение = падение сборки (так задумано). В одном чанке `_next/static/chunks` — кривая громкости Sonata
  (`Math.pow(.01,1-x)` и обратная `Math.log(.01)`) → `.001`: 60 дБ вместо 40, иначе на 1% громко.
- Процент громкости — `ui/volume-percent.ts`: `data-ymsync-volume` на `ChangeVolume_sliderContainer`, рисует `::before`.
  У `PLAYERBAR_DESKTOP` в теме нет `overflow: hidden`: всплывающий ползунок отсчитывается от этой section.
- Electron зафиксирован 38.2.2 (как у клиента 5.122 и 5.123). В asar есть приватный `@yandex-music-int/...` — не ставить
  зависимости клиента через npm, node_modules берутся из asar.
- Фасад плеера Sonata (`sonata.ts::player`): объект в `memoizedState` хука с `playbackController`, `setContext`,
  `setProgress`, `getState`. Используются `setContext`, `setEntityByIndex`, `setProgress(сек)`, `setSpeed(x)`,
  `play`, `resume`, `pause`, `getState().playerState.{status,progress}`, `queueState.{currentEntity,entityList,index}`,
  `currentContext`. Треки ставятся как `{type:"unloaded", meta:{id}}` в контексте `various` с id `ymsync-room-<rev>`.
- Очередь плеера правится на месте (`sonata.ts::updateQueue`): `inject({entitiesData, position})` и
  `remove(positions)` фасада, текущий трек не трогается. Контекст с прежней ревизией после этого несёт новую
  очередь, поэтому «та же очередь» сравнивается по списку id, а не по id контекста.
- Свой автопереход Sonata (`autoMoveForward`) прибавляет 1 к текущему индексу: `setEntityByIndex` в момент, когда
  плеер доигрывает трек, давал переход через трек. Мод в последние 2,5 с трека даёт плееру перейти самому.
- После перезагрузки окна Sonata может продолжить трек с запомненной позиции; ядро возвращает его перемоткой.
- `setEntityByIndex`/`setContext` завершаются раньше подмены источника звука (~0,4 с плеер показывает новый id,
  но длительность и звук старого трека): `loaded` уходит только после `waitUntilOn` (длительность совпала с
  треком очереди или 0). Иначе play/seek ядра доставались старому треку.
- `setContext` на паузе (смена режима волны, пока играла прежняя) меняет трек, но не звук: позиция, длительность
  и аудио — прежние, пока не вызвать `play()`; `resume()` продолжал старый звук. `sonata.ts::staleAudio`: после
  своего `setContext` `waitUntilOn` не ждёт длительности, `play()` вызывает именно `play()`, перемотка
  откладывается до звука, а отчёт плееру даёт позицию 0.
- Колесо на главной: `WHEEL_VIBE_ITEM` — режимы (`playContext` vibe с `seeds`), `WHEEL_RESHUFFLE_ITEM` — «Назад к
  привычному» (`playContext` с `user:onyourwave`, становится обычной волной комнаты) и «Встряхнуть Мою волну»
  (мимо фасада; мод ловит клик в capture на window → `wave {seeds, fresh: true}`). Пункты стоят на абсолютных
  позициях — скрытый оставляет дыру, поэтому не скрываются.
- Позиция Sonata обновляется раз в ~265 мс → `progress.onChange` + досчёт (`livePositionMs`).
- Действия пользователя ловятся перехватом методов фасада (`controller.ts::INTERCEPTS`); свои вызовы — в `asMod()`
  (флаг только на синхронную часть вызова). Аргумент «id воспроизведения» = трейлер/клип, не трогать.
  В комнате `moveForward`/`moveBackward`/`setEntityByIndex` не выполняются в плеере, а уходят командой
  (трек поставит загрузка, у всех одновременно); `injectNext`/`injectLast`/`inject` («Играть следующим», «В конец
  очереди») становятся `play_next`/`enqueue` — меню передаёт id как `трек:альбом`; `removeAndLoadEntities`
  блокируется (у комнаты нет такой команды). «Плавные переходы» — `localStorage.crossFadeMode`.
- `playContext` с `contextData.type === "vibe"` в комнате блокируется и превращается в волну комнаты с его
  `seeds`. Пресеты на странице волны — элементы с `item.{id,title,description,seeds}`.
- Лайк/дизлайк клиента: `POST users/{uid}/likes|dislikes/tracks/add?track-id=id:album` и
  `…/tracks/{id}/remove`; ловятся `onYandexApiRequest` (fetch-перехватчик мода). Дизлайк клиент сам скипает
  через `moveForward` (он и становится «next» для комнаты). Кнопки — `DISLIKE_BUTTON`/`LIKE_BUTTON`
  на панели `VIBE_PLAYERBAR` (главная) и `PLAYERBAR_DESKTOP`.
- Токен — `localStorage.oauth`. DOM: `section[data-test-id="PLAYERBAR_DESKTOP"]`,
  `div[class*="NavbarDesktopUserWidget_userProfileContainer"]`.
- Пока в комнате, фоновый троттлинг окна выключен (`webContents.setBackgroundThrottling(false)`), иначе
  таймеры свёрнутого окна почти встают и синхрон разваливается.
- Скрипт мода выполняется до появления `document.body` — ничего не читать из DOM на верхнем уровне модуля.
- Буквы — горячие клавиши клиента (k, l, j, n, m, …); событие из shadow-корня он не узнаёт как ввод и глотал
  буквы в полях мода. `lib/shadow.tsx::guardModInputs` останавливает клавиши из полей мода на window
  (capture), кроме Escape и Tab.
- Очередь комнаты в плеере — контекст `various`, и главная клиента принимает его за «волну по треку»
  (подпись трека с крестиком). В комнате подпись скрыта (`client-tweaks.ts`, классы `ymsync-in-room`/
  `ymsync-wave-guest` на `<html>` и `--ymsync-room-label`), сверху — волна комнаты; пункты колеса — см. выше.
- Иконки — `mod/branding/` (зелёная звезда, `scripts/green-icons.py` из иконок клиента); патчер кладёт их
  поверх `assets` клиента, `icon.ico` — окно, ярлык, установщик.

### Оформление (тема Modrinth, `ui/theme/modrinth.css`)

- Всё под `html.ymsync-theme`; без класса — оригинальный клиент (настройки мода → «Внешний вид», ключ `ui/theme`).
- Сначала токены клиента: блок `.ym-dark-theme` (и `.ym-light-theme` — тема всегда тёмная) с `--ym-*` цветами,
  радиусами, `--ym-font-text`/`--ym-font-heading`. Большая часть интерфейса перекрашивается сама.
- Каркас — правилами по CSS-модулям (`[class*="Модуль_часть__"]`; хеш после `__` меняется, имя — нет):
  `CommonLayout_root`+`DefaultLayout_root` (сетка: сайдбар `--ms-rail` 4rem, сверху `--ms-topbar` 3rem, справа
  `--ms-dock` — его задаёт мод), `CommonLayout_content`, `Navbar_root`/`NavbarDesktop_*` (подписи пунктов скрыты,
  мод ставит `title`), `Pin_*`, `NavbarDesktopUserWidget_*`, `TitleBar_root` (кнопки окна), `PLAYERBAR_DESKTOP`,
  `VibePage_*`/`WheelDesktop_*` (главная: две карточки; у колеса маска, поэтому рамка — `::before` у
  `VibePage_root`), `Settings_root`/`Settings_item`, карточки `AlbumCard`/`PlaylistCard`/`ArtistCard`,
  `BlockHeader_title`, `SearchPage_input`, `[role=menu]`. Кнопки UI-кита клиента — чистые хеши, только токены.
- Названия на страницах: `[data-test-id="ENTITY_TITLE"]` (h1), тип — `ENTITY_NAME` («Сингл», «Плейлист»).
- Верхняя панель и колонка «Комната» — `FixedHost` (элементы в конце body со своим shadow-корнем) поверх места,
  которое оставляет тема; клиентский DOM не меняется. Колонка своя в окне ≥1100 px (`ui/dock`), уже — поверх.

## Стиль

- Rust: комментарии и doc-комментарии по-английски, объясняют «почему»; сообщения пользователю по-русски.
  Тест на каждое поведение, имена тестов — предложения (`a_late_answer_for_an_old_track_is_ignored`).
- Мод: комментарии по-русски, строгий TS, `neverthrow` в API-хелперах, `import type` для типов
  (Vite/rolldown иначе падает).
- UI мода — React + shadcn/Radix + Tailwind 4 в Shadow DOM (`ui/lib/shadow.tsx`): каждый корень
  (`#yandex-music-sync-root`, `#mod-sheet-container`, `#ymsync-topbar`, `#ymsync-dock`) со своей копией CSS.
  Порталы Radix — через `usePortalContainer()`; всплывающее (Select, Tooltip) — `z-[2147483600]`, выше
  модалки настроек (`z-[2147483000]`), и без своих `z-*` в `className` у вызовов. Шрифт Inter объявлен в документе под именем «YMSync Inter»
  (в shadow-корне @font-face не работает). @property Tailwind в shadow-корне не применяются —
  `withPropertyDefaults` дублирует их начальные значения. Стили самого клиента — только `ui/theme/modrinth.css`
  (оформление) и `ui/client-tweaks.ts` (скрытие блоков).
- Наблюдатели за DOM клиента — не чаще раза за кадр (requestAnimationFrame): клиент меняет DOM постоянно.
- Дизайн-токены — OLED-тема Modrinth: `--ms-*` в `ui/index.css` (shadow-корни) и в `modrinth.css` (документ),
  одни и те же значения: поверхности `#000`→`#303138`, рамки `#1b1b20`/`#25262b`, бренд `#1bd96a`, текст
  `#fff/#b0bac5/#96a2b0`, радиусы кнопок 12px и карточек 16px, Inter; токены shadcn сопоставлены с ними.
- Анимации — Anime.js 4 (`ui/lib/motion.ts`: `animate`, `stagger`, `ease: "outQuart"`), только transform/opacity,
  150–250 мс, при `prefers-reduced-motion` — ничего.
- Тексты интерфейса — по-русски, предложениями, без капса.
- Коммиты: короткий заголовок по-английски, как в истории репозитория.

## Известные проблемы и грабли

- Список комнат и админ работают только с новым релеем; со старым список отвечает «введите название сами»
  (через 6 с), а админа нет. Без Плюса на живом аккаунте не проверено: что сыграет плеер, решает Яндекс.
- Релей с естественным переходом без барьера и `NATURAL_GAP_MS` нужно пересобрать на сервере (`docker compose
  build`): со старым релеем мод работает, но на каждом переходе трека снова ждёт готовности всех.
- Зазор 450 мс — замер на клиенте 5.123; у другой версии он может быть другим (смотреть расхождение сразу
  после естественного перехода: должно быть десятки мс).
- Фидбек волны от остальных участников не идёт (решение: только владелец волны); их дизлайк = пропуск.
- Убрать трек из очереди комнаты нельзя (нет команды в протоколе).
- В сборке остаётся отладочный `window.__yandexSync` (+ `stats`, `player`).
- Discord RPC опрашивает окно `executeJavaScript` 2 раза/с и читает `PLAYERBAR_DESKTOP` (на главной её нет —
  тогда статус пустой); ip-checker ходит на `http://ip-api.com`.
- «Ссылка на Мою коллекцию» без предупреждения делает коллекцию публичной.
- sonner вставляет свои стили в `document.head` (селекторы `[data-sonner-*]` и `--toast-*` на `<html>`).
- Меню профиля — iframe Яндекс ID с чужого домена: тема его не меняет.
- Окружение Windows: в Git Bash `/usr/bin/link` перекрывает MSVC `link.exe` — cargo собирать из PowerShell.
  Bun 1.1.27 не умеет `format: "cjs"` в `Bun.build` → main/preload собираются esbuild. Vite держать на 7.x.
  Heredoc в Git Bash ломается на кавычках, а PowerShell 5.1 — на многострочных сообщениях `git commit -m`:
  длинное — файлом и `git commit -F`.
- При живой проверке через CDP установленная «Яндекс Музыка Sync» должна быть закрыта (один профиль,
  single-instance lock; второй экземпляр на том же аккаунте мешал бы через синхронизацию устройств Яндекса),
  а `ELECTRON_RUN_AS_NODE` снят. Если в профиле включено автоподключение — dev-копия зайдёт в настоящую комнату.

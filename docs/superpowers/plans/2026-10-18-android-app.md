# Яндекс Музыка Sync для Android — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Своё Android-приложение: вход в Яндекс, «Моя волна» с каруселью режимов, «Мне нравится», комнаты как на ПК, полный плеер и само обновляемое медиа-уведомление, настройки, самообновление — в OLED-стиле Modrinth.

**Architecture:** Kotlin + Jetpack Compose — экраны; Media3 `MediaSessionService` + `SimpleBasePlayer` — медиа-сессия, уведомление, гарнитура (фасад над состоянием ядра, звук не играет); общее ядро на Rust (`crates/core`) — комната, волна, API Яндекса и звук (`rodio` → `cpal` → AAudio), через JNI-крейт `crates/android` с JSON-вызовами. Без комнаты ядро держит невидимую комнату на самом телефоне (`host` на `127.0.0.1:0`).

**Tech Stack:** Kotlin, Jetpack Compose (Material 3 + свои токены), Media3 (session), kotlinx.serialization, DataStore; Rust 1.99.1 (edition 2024), `jni`, `rodio`, `cpal`, `rustls`; `cargo-ndk`; Gradle (Kotlin DSL, version catalog); GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-android-app-design.md` (макеты — `docs/superpowers/specs/android-mockups/`).

## Global Constraints

- Только Android; `minSdk 26` (AAudio), `targetSdk`/`compileSdk` — последняя стабильная платформа.
- Ничего из официального приложения Яндекс Музыки: ни кода, ни ресурсов, ни иконок. Иконка приложения — зелёная звезда мода (`mod/branding/icon.png`), она своя.
- Ядро общее с ПК: мост (`crates/bridge`) и мод ведут себя как раньше; `cargo +1.99.1 test --workspace` зелёный после каждой задачи.
- Сборка ядра для хоста (CI на Linux, `cargo test --workspace`) не тянет `rodio`/`cpal`/ALSA: аудио-зависимости Android-крейта — только под `cfg(target_os = "android")`; фича `tls-native` остаётся по умолчанию для моста, Android собирается с `tls-rustls`.
- Протокол 6 с дополнениями (`client_id`, `plus`, админ, `list_rooms`); телефон — обычный клиент тех же комнат.
- Оформление — токены мода: фон `#000`, поверхности `#16181c`/`#1f2026`/`#25262b`/`#303138`, рамки `#1b1b20`/`#25262b`, акцент `#1bd96a`, текст `#ffffff`/`#b0bac5`/`#96a2b0`, радиусы кнопок 12 dp и карточек 16 dp, шрифт Inter (OFL, кладётся в `res/font`).
- Тексты интерфейса — по-русски, предложениями, без капса. Комментарии в Kotlin — по-русски (как в моде), в Rust — по-английски, объясняют «почему»; тесты Rust — именами-предложениями.
- id приложения `ru.combogame.yamodsync`, имя «Яндекс Музыка Sync»; своя версия в `android/version.properties`, релиз с тегом `android-v<версия>`, файл `YaModSync-<версия>.apk` + `SHA256SUMS.txt`.
- Версии Gradle-плагинов и библиотек — последние стабильные на момент Задачи 1 (сверить через Context7 / Google Maven), закрепить в `android/gradle/libs.versions.toml`.
- Секреты (токен Яндекса, ключ подписи, пароли) никуда не выводить и не коммитить.
- Стабильный cargo на машине — 1.76: все команды `cargo +1.99.1 …`; Gradle и cargo — из PowerShell (в Git Bash `link` перекрыт).

## Review Focus

1. **Связь с сервером пропала посреди трека** (метро, смена Wi-Fi) — музыка не обрывается сама, уведомление и экран говорят «переподключаюсь», после возврата связи телефон снова в комнате на нужной позиции. Тест — в Задаче 6 (`a_session_comes_back_when_the_relay_does`).
2. **Звонок или другое приложение забрали звук; выдернули наушники** — без комнаты музыка ставится на паузу; в комнате пауза только у себя (громкость в ноль), комнате ничего не шлётся, после звонка звук возвращается. Тест — в Задаче 9 (`FocusPolicyTest`).
3. **Токен истёк или отозван** — приложение не висит на «загрузке», а возвращает на экран входа с понятной фразой. Тест — в Задаче 6 (`an_expired_token_is_reported_as_such`) и Задаче 8 (`LoginStateTest`).
4. **vivo/OriginOS выгрузил приложение в фоне** — служба переднего плана держит процесс; если он всё же убит, после открытия приложение само возвращается в последнюю комнату (если включено «входить при запуске»). Проверка — в Задаче 18 на телефоне, плюс подсказка про «Батарея → без ограничений» в настройках (Задача 15).
5. **Сервер старой версии** — список комнат не показывается, но вход по названию работает, без зависаний дольше 6 с. Тест — в Задаче 3 (`an_old_relay_lists_nothing_and_says_so`).

---

### Task 1: Инструменты сборки под Android

**Files:**
- Modify: `CLAUDE.md` (раздел «Команды»: как собрать и поставить APK)

**Interfaces:**
- Produces: `ANDROID_HOME` = `%LOCALAPPDATA%\Android\Sdk`; NDK по `ANDROID_NDK_HOME`; Rust-таргеты `aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android` в тулчейне 1.99.1; `cargo-ndk` в PATH; AVD `ymsync-test` (x86_64, последняя платформа).

- [ ] **Step 1:** Скачать Android command-line tools в `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`, через `sdkmanager` поставить `platform-tools`, `platforms;android-<последняя>`, `build-tools;<последние>`, `ndk;<последняя стабильная>`, `emulator`, `system-images;android-<последняя>;google_apis;x86_64`; принять лицензии.
- [ ] **Step 2:** Задать `ANDROID_HOME` и `ANDROID_NDK_HOME` (пользовательские переменные), `rustup target add --toolchain 1.99.1 aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`, `cargo +1.99.1 install cargo-ndk --locked`.
- [ ] **Step 3:** Создать AVD `ymsync-test`.
- [ ] **Step 4: Проверка.** `adb version`, `cargo ndk --version`, `emulator -list-avds` → `ymsync-test`.
- [ ] **Step 5:** Дописать в CLAUDE.md команды (сборка `.so`, сборка/установка APK, запуск эмулятора) — окончательные строки после Задачи 7; коммит: `Document the Android toolchain`.

### Task 2: Ядро для телефона — плеер, rustls, общие команды

**Files:**
- Create: `crates/core/src/player.rs` (из `0189d53^:crates/app/src/player.rs`, под новые методы `Playback`)
- Create: `crates/core/src/ui.rs` (перенос `UiCommand`, `FeedbackKind`, `engine_command` из `crates/bridge/src/protocol.rs`/`lib.rs`)
- Modify: `crates/core/Cargo.toml` (фичи `audio-rodio = ["dep:rodio"]`, `tls-rustls`, как в `0189d53^:crates/app/Cargo.toml`), `crates/core/src/lib.rs`, `crates/bridge/src/protocol.rs`, `crates/bridge/src/lib.rs` (реэкспорт из `ymsync::ui`)
- Test: `crates/core/src/ui.rs` (модуль tests), `crates/core/src/player.rs` (тесты, что были в старом файле)

**Interfaces:**
- Produces: `ymsync::ui::{UiCommand, FeedbackKind, engine_command(UiCommand) -> engine::Command}` — тот же JSON (`{"c": "wave", "seeds": [...], "fresh": true}` и т. д.), что принимает мост; `ymsync::player::Player::new(volume: f32) -> Result<Player>`, `impl Playback for Player` (`needs_bytes() == true`, `plays_while_downloading() == true`, `supports_rate() == false`).

- [ ] **Step 1: Failing test** `the_bridge_and_the_phone_read_one_command_language` в `ui.rs`: `serde_json::from_str::<UiCommand>(r#"{"c":"hand_wave","to":3}"#)` → `UiCommand::HandWave{to:3}`; `{"c":"wave","fresh":true}` → `Wave{seeds: [], fresh: true}`; `engine_command(UiCommand::StopWave) == engine::Command::StopStation`.
- [ ] **Step 2:** `cargo +1.99.1 test -p ymsync ui::` → FAIL (нет модуля).
- [ ] **Step 3:** Перенести типы в `ui.rs`, в мосте оставить `pub use ymsync::ui::{UiCommand, FeedbackKind}` и вызов `ymsync::ui::engine_command`; тесты протокола моста не меняются.
- [ ] **Step 4:** Вернуть `player.rs` и фичи; `cargo +1.99.1 test --workspace` → PASS (мост, релей, ядро — как прежде).
- [ ] **Step 5: Кросс-сборка.** `cargo +1.99.1 ndk -t arm64-v8a --platform 26 build -p ymsync --no-default-features --features audio-rodio,tls-rustls` → успех.
- [ ] **Step 6:** Коммит `Bring the core's own player and rustls back for the phone; share UI commands`.

### Task 3: Список комнат из ядра

**Files:**
- Modify: `crates/core/src/link.rs`
- Test: `crates/core/tests/rooms.rs`

**Interfaces:**
- Produces: `ymsync::link::list_rooms(relay: &str, token: &str) -> Result<Vec<ymsync_proto::RoomListing>>`; ошибки различимы: `RoomsError::{Unauthorized, OldRelay, Unreachable(String)}` (`thiserror` не тянуть — свой enum + `Display` по-русски, как в моде: «неверный пароль», «сервер не прислал список комнат — возможно, он старой версии. Введите название сами», «не удалось подключиться к серверу»).

- [ ] **Step 1: Failing tests** с встроенным релеем (`ymsync_relay::bind("127.0.0.1:0", "t")`): `rooms_are_listed_with_who_is_in_them` (два `Link::connect_as` в «дом» и «работа» → два элемента, сначала занятые), `a_wrong_password_lists_nothing` (`Unauthorized`), `an_old_relay_lists_nothing_and_says_so` (сервер-заглушка на `TcpListener`, принимает WebSocket и молчит → `OldRelay` не позже чем через 6 с).
- [ ] **Step 2:** `cargo +1.99.1 test -p ymsync --test rooms` → FAIL.
- [ ] **Step 3:** Реализовать: `connect_async`, `ClientMsg::ListRooms{protocol: PROTOCOL_VERSION, token}`, ждать `ServerMsg::Rooms` / `Error{code:"unauthorized"}`, таймаут 6 с → `OldRelay`.
- [ ] **Step 4:** Тесты → PASS; `cargo +1.99.1 test --workspace` → PASS.
- [ ] **Step 5:** Коммит `List a relay's rooms from the core`.

### Task 4: Режимы волны (карусель) из API

**Files:**
- Modify: `crates/core/src/api.rs`
- Test: `crates/core/src/api.rs` (tests) + фикстура `crates/core/tests/fixtures/wave-presets.json`

**Interfaces:**
- Produces: `pub struct WavePreset { pub id: String, pub title: String, pub description: Option<String>, pub seeds: Vec<String>, pub cover_uri: Option<String> }` (Serialize), `YandexMusic::wave_presets(&self) -> Result<Vec<WavePreset>>`.

- [ ] **Step 1: Найти запрос.** Запустить dev-копию мода с CDP (CLAUDE.md: `electron .versions/<v>/mod --remote-debugging-port=9333`, установленная копия закрыта), открыть главную, записать сетевые запросы (CDP `Network.enable`) и найти ответ, из которого клиент строит колесо (`WHEEL_VIBE_ITEM`: `title`, `description`, `seeds`). Записать метод, путь, параметры и сохранить обезличенный ответ в фикстуру. Результат шага — путь запроса и фикстура; если ответа с сидами нет — остановиться и сообщить.
- [ ] **Step 2: Failing test** `the_wheel_is_read_from_its_landing_block`: разбор фикстуры даёт ≥ 5 пресетов, у каждого непустые `title` и `seeds`, первый пресет совпадает с первым элементом фикстуры.
- [ ] **Step 3:** `cargo +1.99.1 test -p ymsync wheel` → FAIL.
- [ ] **Step 4:** Реализовать запрос и разбор по найденной форме ответа.
- [ ] **Step 5:** PASS; коммит `Read the wave's presets for the phone's carousel`.

### Task 5: Качество звука

**Files:**
- Modify: `crates/core/src/api.rs` (`stream_url`), `crates/core/src/config.rs`, `crates/core/src/engine.rs` (передать качество)
- Test: `crates/core/src/api.rs` (tests)

**Interfaces:**
- Produces: `pub enum Quality { High, Lossless }` (`serde(rename_all = "snake_case")`, по умолчанию `High`), `Config.quality: Quality`, `YandexMusic::stream_url_with(&self, track_id: &str, quality: Quality) -> Result<String>`; `stream_url` = `stream_url_with(.., High)`.

- [ ] **Step 1: Проверить API.** На аккаунте с Плюсом (токен — из dev-копии мода, наружу не выводить) запросить для одного трека варианты загрузки (`download-info` и/или `get-file-info` c `quality=lossless`); записать, приходит ли flac и в каком поле. Обезличенный ответ — в фикстуру.
- [ ] **Step 2: Failing test** `lossless_picks_flac_when_offered_and_mp3_otherwise` по фикстурам: при `Lossless` выбирается вариант `flac`, если он есть, иначе лучший mp3; при `High` — лучший mp3 (как сейчас).
- [ ] **Step 3:** FAIL → реализовать выбор → PASS; мост не меняется (`plays_by_id` качество не трогает).
- [ ] **Step 4:** Коммит `Let the phone ask for lossless when the account has it`. (Если flac для этого клиента не отдаётся — оставить только `High`, в настройках пункта «без потерь» нет; записать в CLAUDE.md.)

### Task 6: Android-крейт: JNI и сессия

**Files:**
- Create: `crates/android/Cargo.toml`, `crates/android/src/lib.rs` (`install_android_context`, как в `0189d53^`), `crates/android/src/ffi.rs`, `crates/android/src/session.rs`
- Modify: `Cargo.toml` (members), `.gitignore` (`/crates/android/jniLibs`)
- Test: `crates/android/src/session.rs` (tests, на хосте; аудио — заглушка `Playback` в тестах)

**Interfaces:**
- Consumes: `ymsync::ui::UiCommand` (Задача 2), `ymsync::link::list_rooms` (3), `YandexMusic::wave_presets` (4), `Quality` (5), `ymsync::session::start`.
- Produces (JNI, класс `ru.combogame.yamodsync.core.Native`, каждый ответ — JSON `{"ok": …}` или `{"error": "…", "code": "…"}`):
  - `start(configJson: String, context: Any): String` — config `{ "token": str, "client_id": str, "data_dir": str, "quality": "high"|"lossless", "name": str, "room": null | {"relay": str, "room": str, "password": str} }`; `room: null` → своя невидимая комната (`host.enabled`, `bind "127.0.0.1"`, `port 0`, `discoverable false`, случайный токен); `ok` = handle (Long).
  - `snapshot(handle: Long): String` — `engine::Snapshot` без `cached`/`on_lan` + поле `status`: `"connected"|"reconnecting"`, `error?`.
  - `command(handle: Long, commandJson: String): String` — `UiCommand`.
  - `likes(handle: Long): String` → `{"ok": [TrackRef]}`; `lyrics(handle: Long, trackId: String)` → `{"ok": {"lines": […]} | null}`; `wavePresets(handle: Long)` → `{"ok": [WavePreset]}`.
  - `rooms(relay: String, password: String): String` — без сессии.
  - `account(token: String): String` → `{"ok": {"login", "display_name", "plus": bool|null}}`, код `"unauthorized"` при 401.
  - `stop(handle: Long): String`.
- Аудио-зависимости (`ymsync` с `audio-rodio`, `tls-rustls`; `ndk-context`) — только `[target.'cfg(target_os = "android")'.dependencies]`; на хосте `start` с реальным плеером недоступен, тесты подменяют `Playback`.

- [ ] **Step 1: Failing tests** в `session.rs` (встроенный релей, заглушка плеера): `a_solo_session_plays_without_a_server` (`room: null` → `snapshot.connected == true`, `listeners.len() == 1`); `a_session_comes_back_when_the_relay_does` (комната на внешнем релее; релей остановлен → `status == "reconnecting"`; поднят снова на том же адресе → `connected` в течение 20 с — поведение как `supervise` в мосте: бэкофф 1/3/7/15 с); `an_expired_token_is_reported_as_such` (`account` против фейкового API с 401 → `code == "unauthorized"`).
- [ ] **Step 2:** `cargo +1.99.1 test -p ymsync-android` → FAIL.
- [ ] **Step 3:** Реализовать `session.rs` (рантайм tokio на сессию, переподключение по образцу `crates/bridge/src/lib.rs::supervise`, снапшот — как `send_snapshot` моста плюс `queue`) и `ffi.rs` (по образцу `0189d53^:crates/android/src/ffi.rs`, только перечисленные функции; паника не должна пересекать JNI — `catch_unwind` → `{"error"}`).
- [ ] **Step 4:** PASS; `cargo +1.99.1 test --workspace` → PASS.
- [ ] **Step 5:** `cargo +1.99.1 ndk -t arm64-v8a -t armeabi-v7a -t x86_64 --platform 26 -o crates/android/jniLibs build --release -p ymsync-android` → три `libymsync_android.so`.
- [ ] **Step 6:** Коммит `Android core: JNI surface, solo and room sessions`.

### Task 7: Android-проект, тема, связь с ядром

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, `android/gradle/libs.versions.toml`, `android/version.properties` (`versionName=0.1.0`, `versionCode=1`), `android/app/build.gradle.kts` (jniLibs из `../../crates/android/jniLibs`, подпись из `keystore.properties` — как в `0189d53^`), `android/app/src/main/AndroidManifest.xml`
- Create: `.../yamodsync/YaModSyncApp.kt`, `MainActivity.kt`, `core/Native.kt`, `core/Models.kt`, `core/CoreSession.kt`
- Create: `.../ui/theme/Tokens.kt`, `Theme.kt`, `Type.kt`, `res/font/inter_*.ttf`, иконка из `mod/branding/icon.png` (адаптивная, `mipmap-anydpi-v26`)
- Test: `android/app/src/test/.../core/ModelsTest.kt`, `CoreSessionTest.kt`

**Interfaces:**
- Consumes: JNI из Задачи 6.
- Produces: `@Serializable data class RoomSnapshot` (поля как `RoomSnapshot` в `mod/src/mod/features/yandex-sync/controller.ts` + `status`, `error`), `TrackRef`, `Listener(peer, name, you, admin, plus, feeds)`, `WavePreset`, `RoomListing`; `parseStation(station: String?): StationInfo?` и `isPlainWave(StationInfo)` — как в `controller.ts`; `class CoreSession(native: NativeApi) { val snapshot: StateFlow<RoomSnapshot?>; suspend fun start(config: StartConfig): Result<Unit>; fun command(cmd: RoomCommand); suspend fun stop() }` — опрос снапшота 4 раза в секунду, пока сессия жива; `interface NativeApi` — обёртка над `Native` (для тестов подменяется); `sealed interface RoomCommand` → JSON `UiCommand`.
- Цвета и формы — `YaTokens` (значения из Global Constraints), тема только тёмная.

- [ ] **Step 1: Failing tests** `ModelsTest`: реальный снапшот моста (снять из dev-копии мода `window.__yandexSync.getSyncState().room`, обезличить, положить в `src/test/resources/snapshot.json`) разбирается без ошибок, лишние поля игнорируются; `parseStation` читает JSON-спеку и голый сид; `RoomCommand.Wave(fresh = true)` сериализуется в `{"c":"wave","seeds":[],"fresh":true}`. `CoreSessionTest`: с фейковым `NativeApi` после `start` `snapshot` получает значение, после `stop` опрос прекращается.
- [ ] **Step 2:** `cd android; .\gradlew.bat testDebugUnitTest` → FAIL.
- [ ] **Step 3:** Реализовать; `MainActivity` пока показывает «Ядро запущено: N слушателей» из solo-сессии на пустом токене.
- [ ] **Step 4:** PASS; `.\gradlew.bat assembleDebug` → APK; поставить на эмулятор (`adb install -r`), запуск без падения, в логе нет `UnsatisfiedLinkError`.
- [ ] **Step 5:** Окончательные команды сборки — в CLAUDE.md (Задача 1, шаг 5); коммит `Android app skeleton: theme, core bridge`.

### Task 8: Вход в Яндекс

**Files:**
- Create: `.../auth/LoginScreen.kt`, `auth/TokenStore.kt`, `auth/LoginState.kt`
- Test: `.../auth/LoginStateTest.kt`

**Interfaces:**
- Consumes: `Native.account` (6).
- Produces: `TokenStore { val token: Flow<String?>; suspend fun save(token: String); suspend fun clear() }` (DataStore, приватный файл приложения); `sealed interface LoginState { SignedOut(reason: String?); Checking; SignedIn(login: String, name: String, plus: Boolean?) }`; `fun loginStateFor(accountJson: String): LoginState`.
- WebView на `https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d` (как в `0189d53^`), токен — из `#access_token=` адреса перенаправления; пароль вводится только на странице Яндекса.

- [ ] **Step 1: Failing test** `LoginStateTest`: `{"ok":{"login":"x","display_name":"Рома","plus":true}}` → `SignedIn`; `{"error":"…","code":"unauthorized"}` → `SignedOut("Вход устарел — войдите снова")`; сетевой `error` без кода → `SignedOut` не выставляется (остаётся `SignedIn` с прошлым токеном и показывается ошибка сети).
- [ ] **Step 2:** FAIL → реализовать (экран входа в стиле приложения, WebView во весь экран под шапкой «Вход в Яндекс») → PASS.
- [ ] **Step 3:** На эмуляторе: вход реальным аккаунтом пользователя не делать — проверить, что страница Яндекса открывается и перехват адреса срабатывает на тестовом редиректе; вход на телефоне — в Задаче 18.
- [ ] **Step 4:** Коммит `Sign in to Yandex inside the app`.

### Task 9: Служба воспроизведения и уведомление-плеер

**Files:**
- Create: `.../playback/PlaybackService.kt` (`MediaSessionService`, foreground type `mediaPlayback`, wake lock, `WifiLock`), `playback/CorePlayer.kt` (`SimpleBasePlayer`), `playback/PlayerStateMapper.kt`, `playback/FocusPolicy.kt`
- Modify: `AndroidManifest.xml` (служба, разрешения `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, `INTERNET`)
- Test: `.../playback/PlayerStateMapperTest.kt`, `FocusPolicyTest.kt`

**Interfaces:**
- Consumes: `CoreSession` (7).
- Produces: `fun mapToPlayerState(s: RoomSnapshot, coverBitmapUri: Uri?): SimpleBasePlayer.State` — одна позиция-элемент (текущий трек: title, artist, artworkUri, duration), `playWhenReady = room_playing || waiting`, позиция `position_ms`, доступные команды PLAY_PAUSE, SEEK_TO_NEXT, SEEK_TO_PREVIOUS, SEEK_IN_CURRENT; лайк — кастомная кнопка `SessionCommand("like")`; `CorePlayer` переводит `handleSetPlayWhenReady` → `toggle`, `handleSeek` → `seek`, next/prev → `next`/`prev`, лайк → `like` (в ядре — `Command::Like`), а если этот телефон ведёт волну (`feeding`) — ещё `wave_feedback like`/`unlike`, как мод на ПК.
- `enum class FocusEvent { LossTransient, LossTransientCanDuck, Loss, Gain, BecomingNoisy }`; `fun focusAction(e: FocusEvent, inRoom: Boolean): FocusAction` — `FocusAction.{PauseRoom, MuteLocally, Duck, RestoreVolume, Nothing}`.

- [ ] **Step 1: Failing tests** `PlayerStateMapperTest`: снапшот с треком «Молчи — кис-кис», `room_playing=true` → заголовок, артист, `playWhenReady`, позиция; `track=null` → пустой плейлист и `STATE_IDLE`. `FocusPolicyTest`: без комнаты `LossTransient`→`PauseRoom`, `BecomingNoisy`→`PauseRoom`; в комнате `LossTransient`→`MuteLocally`, `BecomingNoisy`→`MuteLocally`, `Gain`→`RestoreVolume`, `LossTransientCanDuck`→`Duck` в обоих случаях.
- [ ] **Step 2:** FAIL → реализовать; уведомление строит Media3 (`DefaultMediaNotificationProvider`) из состояния `CorePlayer`, которое обновляется на каждом снапшоте, — так оно меняется само при смене трека и паузе из комнаты → PASS.
- [ ] **Step 3: Эмулятор.** Solo-сессия с тестовой очередью: уведомление с названием и кнопками; «вперёд» из шторки меняет трек и уведомление; экран выключен — уведомление на экране блокировки; `adb shell input keyevent KEYCODE_MEDIA_PLAY_PAUSE` ставит паузу.
- [ ] **Step 4:** Коммит `Media session and self-updating player notification`.

### Task 10: Оболочка: вкладки, шапка, мини-плеер

**Files:**
- Create: `.../ui/shell/AppShell.kt`, `ui/shell/TopBar.kt`, `ui/shell/MiniPlayer.kt`, `ui/shell/RoomPill.kt`
- Test: `.../ui/shell/RoomPillTest.kt` (текст значка комнаты)

**Interfaces:**
- Consumes: `CoreSession.snapshot`, `LoginState`.
- Produces: `@Composable AppShell(session: CoreSession, onOpenPlayer: () -> Unit, onOpenSettings: () -> Unit)`; вкладки `Tab.{Home, Collection, Room}`; `fun roomPillText(s: RoomSnapshot?, roomName: String?): String` — «дом · 3» / «Переподключаюсь» / «Не в комнате».

- [ ] **Step 1: Failing test** `RoomPillTest` для трёх случаев (в комнате с 3 слушателями; `status=reconnecting`; solo-сессия → «Не в комнате»).
- [ ] **Step 2:** FAIL → реализовать по макету `android-mockups/screens.html` (вкладки снизу, мини-плеер над ними: обложка, название, артист, пауза, полоса прогресса; аватар справа сверху; значок комнаты на Главной) → PASS.
- [ ] **Step 3:** Скриншот эмулятора (`adb exec-out screencap -p`) сверить с макетом: три вкладки, мини-плеер, OLED-фон.
- [ ] **Step 4:** Коммит `App shell: tabs, top bar, mini player`.

### Task 11: Главная — «Моя волна» и карусель

**Files:**
- Create: `.../ui/home/HomeScreen.kt`, `ui/home/WaveHero.kt`, `ui/home/PresetCarousel.kt`
- Test: `.../ui/home/WaveCommandsTest.kt`

**Interfaces:**
- Consumes: `Native.wavePresets` (через `CoreSession`), `RoomSnapshot`, `parseStation`, `isPlainWave`.
- Produces: `fun waveCommand(preset: WavePreset?): RoomCommand` (null → `Wave(seeds = [])`); `fun canStartWave(s: RoomSnapshot): Boolean` (`has_plus != false`) и `fun waveOwner(s: RoomSnapshot): String?` — как в `controller.ts`.

- [ ] **Step 1: Failing test**: `waveCommand(null)` → `Wave([])`; пресет с `seeds=["genre:rnb"]` → `Wave(["genre:rnb"])`; `canStartWave` ложно при `has_plus=false`; `waveOwner` = `by` чужой волны, `null` для своей, для админа и для `station_unfed`.
- [ ] **Step 2:** FAIL → реализовать экран: крупный блок волны (подпись «Волна комнаты: …», «подбирается для …»), кнопка воспроизведения; карусель карточек пресетов; «Встряхнуть» (`Wave(seeds, fresh=true)`); «Вернуться к „Моей волне“» при пресете; гостю чужой волны и без Плюса — тост с теми же фразами, что в моде (`NEEDS_PLUS_TEXT`, «Волну ведёт X: режим и очередь меняет только он») → PASS.
- [ ] **Step 3:** На эмуляторе без входа экран показывает приглашение войти; полная проверка — в Задаче 18.
- [ ] **Step 4:** Коммит `Home: my wave and its presets`.

### Task 12: Коллекция — «Мне нравится»

**Files:**
- Create: `.../ui/collection/CollectionScreen.kt`
- Test: `.../ui/collection/LikesCommandsTest.kt`

**Interfaces:**
- Consumes: `Native.likes`, `RoomSnapshot.liked_revision` (перечитать список, когда он сменился).
- Produces: `fun playLikes(tracks: List<TrackRef>, start: Int, shuffle: Boolean): List<RoomCommand>` → `[Shuffle(shuffle), SetQueue(tracks, start)]`.

- [ ] **Step 1: Failing test**: «Слушать» → `SetQueue(all, 0)` с `Shuffle(false)`; «Вперемешку» → `Shuffle(true)` и `SetQueue`; нажатие на 5-й трек → `SetQueue(all, 4)`.
- [ ] **Step 2:** FAIL → реализовать (шапка «Мне нравится · N треков», две кнопки, список с сердечком: снять лайк — `like(track, false)`, с подтверждением не нужно) → PASS.
- [ ] **Step 3:** Коммит `Collection: liked tracks`.

### Task 13: Полный плеер

**Files:**
- Create: `.../ui/player/FullPlayer.kt`, `ui/player/LyricsSheet.kt`, `ui/player/QueueSheet.kt`, `ui/player/PresetsSheet.kt`, `ui/player/MoreSheet.kt`, `ui/player/CoverGlow.kt`
- Test: `.../ui/player/PlayerTextsTest.kt`

**Interfaces:**
- Consumes: `RoomSnapshot`, `Native.lyrics`, пресеты (11).
- Produces: `fun sourceLabel(s: RoomSnapshot): String` («Волна комнаты «дом»», «Моя волна», «Мне нравится», «Очередь комнаты»); `fun syncLine(s: RoomSnapshot): String?` — как `syncState` в `now-playing.tsx` мода («В синхроне с комнатой · 38 мс», «Догоняю комнату», `null` без комнаты).

- [ ] **Step 1: Failing test** для `sourceLabel` и `syncLine` (solo → `null`; `drift_ms=38` → «В синхроне с комнатой · 38 мс»).
- [ ] **Step 2:** FAIL → реализовать по макету `android-mockups/player.html` и скриншоту пользователя: сверху «свернуть», «Сейчас играет / <источник>», «поделиться» (ссылка `https://music.yandex.ru/album/<album>/track/<id>`); обложка; название бегущей строкой, артист, значок E, сердечко; прогресс с перемоткой; ряд повтор/назад/плей/вперёд/перемешать (`SetRepeat`, `prev`, `toggle`, `next`, `shuffle`); строка синхрона; внизу четыре значка без подписей: текст, режим волны (лист с каруселью), очередь (лист: ближайшие треки, нажатие — `index`), «Ещё» (не нравится → `wave_feedback dislike` + `next`, артист/альбом — пока ссылкой в браузер). Фон — отсвет доминирующего цвета обложки (`androidx.palette`) на чёрном → PASS.
- [ ] **Step 3:** Скриншот сверить с `player.html` (порядок и состав кнопок).
- [ ] **Step 4:** Коммит `Full player`.

### Task 14: Комната

**Files:**
- Create: `.../ui/room/RoomScreen.kt`, `ui/room/JoinForm.kt`, `ui/room/RoomList.kt`, `ui/room/WaveCard.kt`, `ui/room/Listeners.kt`
- Test: `.../ui/room/RoomRulesTest.kt`

**Interfaces:**
- Consumes: `Native.rooms`, `CoreSession.start/stop` (переход solo ↔ комната — остановить сессию и запустить новую с `room`), `waveOwner`, `canStartWave`.
- Produces: `fun handOverCandidates(s: RoomSnapshot): List<Listener>` — как в `wave-card.tsx` (не ведущий волну, `plus != false`, себя — только админу); `fun adminActions(s: RoomSnapshot, row: Listener): Set<AdminAction>` (`HandWave`, `MakeAdmin`).

- [ ] **Step 1: Failing test**: `handOverCandidates` исключает ведущего и «без Плюса», включает себя только для админа; `adminActions` пусто для не-админа и для своей строки; `HandWave` нет, если волны нет.
- [ ] **Step 2:** FAIL → реализовать: не в комнате — адрес, пароль, ник, список комнат (через 600 мс после ввода адреса и пароля, кнопка «Обновить»), «Или новая комната» + «Создать»; ошибки — фразами из Задачи 3; в комнате — карточка «что играет» и синхрон, карточка волны (как `WaveCard` мода), «Слушают» со значками и действиями админа, «Дальше», «Выйти», пинг. Последняя комната и пароль — в настройках приложения (DataStore), пароль не логировать; при запуске приложения с включённым «входить при запуске» и сохранённой комнатой — сразу вход в неё, иначе solo-сессия; «Выйти» — снова solo-сессия → PASS.
- [ ] **Step 3:** Эмулятор: список комнат с локального релея на ПК (`ws://10.0.2.2:8799`, токен `test-room`, `target\release\ymsync-relay.exe --bind 0.0.0.0:8799`) — комнаты видны, вход работает.
- [ ] **Step 4:** Коммит `Room: server's rooms, joining, wave and listeners`.

### Task 15: Настройки

**Files:**
- Create: `.../settings/AppSettings.kt` (DataStore), `.../ui/settings/SettingsScreen.kt`
- Test: `.../settings/AppSettingsTest.kt`

**Interfaces:**
- Produces: `data class AppSettings(val theme: Theme = Theme.Oled, val accent: Accent = Accent.Green, val quality: Quality = Quality.High, val autoJoin: Boolean = false, val name: String = "", val clientId: String)` — `clientId` генерируется один раз (`UUID`) и не меняется; `Theme.{Oled, Graphite}` (фон `#000` / `#16181c`), `Accent.{Green #1bd96a, Blue #4f9cff, Orange #e08325, Violet #c084fc}`.

- [ ] **Step 1: Failing test**: значения по умолчанию; `clientId` стабилен между двумя чтениями; смена `quality` сохраняется.
- [ ] **Step 2:** FAIL → реализовать экран (по аватару): аккаунт (имя, Плюс, «Выйти» → `TokenStore.clear`), подключение (адрес, пароль, ник, «входить при запуске»), внешний вид (тема, акцент — тема приложения меняется сразу), качество звука (пункт «без потерь» — только если Задача 5 его оставила; смена перезапускает сессию), обновления (Задача 16), «Работа в фоне» — кнопка в системные настройки батареи приложения (`ACTION_APPLICATION_DETAILS_SETTINGS`) с пояснением для vivo, о приложении (версия, ссылка на GitHub) → PASS.
- [ ] **Step 3:** Коммит `Settings`.

### Task 16: Самообновление

**Files:**
- Create: `.../update/Updater.kt` (по образцу `0189d53^:android/.../Updater.kt`), `update/UpdateCard.kt`
- Modify: `AndroidManifest.xml` (`REQUEST_INSTALL_PACKAGES`, `FileProvider`)
- Test: `.../update/UpdaterTest.kt`

**Interfaces:**
- Produces: `fun newerVersion(candidate: String, than: String): Boolean` (по числам, как `newer` в `mod/src/mod/main/updater.ts`); `fun pickRelease(releasesJson: String, current: String): Release?` — последний не-draft, не-prerelease с тегом `android-v*`, с файлом `YaModSync-*.apk`, новее текущей; `data class Release(version, notes, apkUrl, sumsUrl, size)`.

- [ ] **Step 1: Failing test**: `newerVersion("0.10.0","0.9.3") == true`; `pickRelease` по JSON с релизами `mod-v1.2.0`, `android-v0.2.0`, `android-v0.1.0` при текущей `0.1.0` → `0.2.0`; при текущей `0.2.0` → `null`; релиз без apk пропускается.
- [ ] **Step 2:** FAIL → реализовать: проверка через 15 с после запуска и раз в 6 ч (`api.github.com/repos/ComboGame/YaMod-Sync/releases`), карточка в настройках и баннер на Главной, скачивание в кэш с прогрессом, сверка SHA-256 с `SHA256SUMS.txt`, установка через `PackageInstaller` (сначала — просьба разрешить «установку из этого источника») → PASS.
- [ ] **Step 3:** Коммит `Update the app from GitHub releases`.

### Task 17: Релиз в CI и ключ подписи

**Files:**
- Create: `.github/workflows/android-release.yml`
- Modify: `.github/workflows/ci.yml` (на Linux `cargo test --workspace` уже покрывает `ymsync-android` без аудио), `docs/android.md` (новый: как поставить приложение, как выпустить релиз)

**Interfaces:**
- Consumes: секреты `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (имена — как в `0189d53^:.github/workflows/release.yml`).

- [ ] **Step 1:** Workflow: на пуш в `main`, затрагивающий `android/**`, `crates/**`, `Cargo.*`, — `cargo ndk` (три ABI, `--platform 26`), `gradlew assembleRelease` с подписью из секретов, `YaModSync-<версия>.apk` + `SHA256SUMS.txt`; если релиза `android-v<версия>` ещё нет — создать его (заметки — `release-notes/android.md`). Без секретов — предупреждение и неподписанный артефакт, релиз не создаётся.
- [ ] **Step 2:** Сгенерировать ключ (`keytool -genkeypair -alias yamodsync -keyalg RSA -keysize 4096 -validity 36500`) в папку пользователя вне репозитория; пароли — случайные; ничего из этого не выводить в чат и не коммитить.
- [ ] **Step 3:** `docs/android.md`: пошагово для новичка — куда в GitHub вставить четыре секрета (Settings → Secrets and variables → Actions → New repository secret), где лежит ключ и почему его копию надо сохранить; как поставить APK на телефон.
- [ ] **Step 4: Проверка.** Локально `gradlew assembleRelease` с `keystore.properties` → подписанный APK (`apksigner verify --print-certs`).
- [ ] **Step 5:** Коммит `Release the Android app from CI`.

### Task 18: Живая проверка на телефоне и документация

**Files:**
- Modify: `CLAUDE.md` (раздел про Android: устройство, команды, хрупкие места), `README.md`, `release-notes/android.md`

- [ ] **Step 1:** Пользователь включает отладку по USB на vivo X200 Pro mini и подключает телефон; `adb devices` → устройство `device`. Поставить release-APK.
- [ ] **Step 2: Сценарии** (каждый — да/нет с замером):
  - вход в Яндекс аккаунтом пользователя; Плюс определён;
  - «Моя волна» и пресет из карусели играют, «Встряхнуть» и «Вернуться к „Моей волне“» работают;
  - «Мне нравится» — «Слушать», «Вперемешку», снять лайк;
  - комната на сервере пользователя в отдельной комнате (не «Hueta»), вместе с ПК: расхождение после старта и после естественного перехода — десятки мс; пауза с телефона ставит паузу на ПК и наоборот; передача волны между ПК и телефоном;
  - экран выключен 10 минут — музыка играет; уведомление меняется при смене трека и при паузе с ПК; кнопки уведомления и гарнитуры работают; звонок — звук пропадает и возвращается, в комнате у остальных не пауза;
  - выключить Wi-Fi на минуту посреди трека — «Переподключаюсь», потом снова в комнате;
  - самообновление — с тестовым релизом выше текущей версии.
- [ ] **Step 3:** Найденное — исправить по месту (с тестом, где поведение в Rust или в чистых функциях Kotlin), результаты и хрупкие места — в CLAUDE.md.
- [ ] **Step 4:** Коммит `Android app: live check on the phone, docs`.

# Приложение для Android

Яндекс Музыка Sync для телефона: «Моя волна», «Мне нравится», комнаты как на ПК,
плеер с уведомлением. Код — `android/` (Kotlin, Jetpack Compose, Media3) и
`crates/android/` (ядро на Rust, то же, что у моста на ПК).

## Как поставить на телефон

1. Откройте на телефоне страницу релизов: <https://github.com/ComboGame/YaMod-Sync/releases>
   и найдите релиз «Яндекс Музыка Sync для Android» (тег `android-v…`).
2. Нажмите на `YaModSync-<версия>.apk` — файл скачается.
3. Откройте скачанный файл (шторка уведомлений или «Загрузки»). Android спросит,
   можно ли ставить приложения из браузера, — разрешите и вернитесь назад.
4. «Установить». Google Play Защита может предупредить о приложении не из магазина:
   «Подробнее» → «Всё равно установить».
5. Откройте приложение и войдите в аккаунт Яндекса.
6. На vivo: «Настройки» приложения → «Работа в фоне» → «Открыть настройки приложения»,
   там «Батарея» → «Фоновое энергопотребление» → «Разрешить». Без этого телефон
   останавливает музыку с выключенным экраном.

Следующие версии приходят сами: «Настройки» → «Обновления» → «Скачать и установить».
Приложение проверяет контрольную сумму файла, а Android — что он подписан тем же ключом.

## Как выпустить новую версию

1. Поднимите версию в `android/version.properties`: `versionName` (например, `0.2.0`)
   и `versionCode` — на единицу больше прошлого. Без нового `versionCode` Android не
   поставит обновление поверх.
2. Допишите «Что нового» в `release-notes/android.md` (оно показывается в приложении).
3. Закоммитьте и отправьте в `main` (`git push`).
4. GitHub Actions соберёт APK (вкладка **Actions** → **android-release**, ~15 минут)
   и создаст релиз `android-v<версия>`. Если релиз с такой версией уже есть, новый
   не создаётся — значит, забыли поднять версию.

Кнопка **Run workflow** на странице workflow собирает APK без релиза: его можно
скачать в разделе **Artifacts** у запуска.

## Ключ подписи и секреты GitHub

Каждый APK подписывается одним и тем же ключом. Android обновляет приложение только
APK с той же подписью, поэтому ключ нужен навсегда.

**Где ключ.** Папка `C:\Users\User\YaModSync-keys` (вне репозитория):

| Файл | Что это |
|---|---|
| `yamodsync-release.jks` | сам ключ |
| `ANDROID_KEYSTORE_BASE64.txt` | тот же ключ одной строкой — для GitHub |
| `секреты-для-github.txt` | пароль и имя ключа, что куда вставить |

**Сохраните копию этой папки** — на флешку или в облако с паролем. Потеряете ключ —
новые версии не встанут поверх, приложение придётся удалить (вместе со входом и
настройками) и поставить заново. Никому не пересылайте папку и не кладите её в git.

**Как добавить секреты в GitHub** (один раз):

1. Откройте <https://github.com/ComboGame/YaMod-Sync> → вкладка **Settings** (справа вверху,
   нужна роль владельца).
2. Слева: **Secrets and variables** → **Actions**.
3. Кнопка **New repository secret**. Поле **Name** — имя секрета, **Secret** — значение,
   потом **Add secret**. Так четыре раза:

   | Name | Secret |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | всё содержимое `ANDROID_KEYSTORE_BASE64.txt` (откройте Блокнотом, Ctrl+A, Ctrl+C) |
   | `ANDROID_KEYSTORE_PASSWORD` | пароль из `секреты-для-github.txt` |
   | `ANDROID_KEY_ALIAS` | `yamodsync` |
   | `ANDROID_KEY_PASSWORD` | тот же пароль |

4. Проверка: **Actions** → **android-release** → **Run workflow**. В логе шага
   «Check the signature» должно быть `Verifies`. Без секретов workflow пишет
   предупреждение «no signing key» и релиз не создаёт.

## Сборка у себя

Нужны Android SDK, NDK, JDK 21 и Rust с таргетами Android (подробности — в `CLAUDE.md`).

```powershell
# ядро на Rust → crates/android/jniLibs
cargo +1.99.1 ndk -t arm64-v8a -t armeabi-v7a -t x86_64 --platform 26 -o crates/android/jniLibs build --release -p ymsync-android
cd android
.\gradlew.bat :app:testDebugUnitTest      # тесты
.\gradlew.bat :app:assembleDebug          # отладочная сборка
.\gradlew.bat :app:assembleRelease        # подписанная, если есть android/keystore.properties
```

`android/keystore.properties` (не в git) указывает на ключ:

```
storeFile=C:/Users/User/YaModSync-keys/yamodsync-release.jks
storePassword=…
keyAlias=yamodsync
keyPassword=…
```

Поставить на телефон по кабелю: включите «Для разработчиков» → «Отладка по USB»,
подключите телефон и выполните `adb install -r app\build\outputs\apk\release\app-release.apk`.
На vivo включён пункт «Проверять приложения при установке через ADB» — при установке
на телефоне появится окно проверки, его нужно подтвердить. Отладочная и release-сборки
подписаны разными ключами: чтобы поменять одну на другую, сначала удалите приложение.

В debug-сборке есть витрина экранов на выдуманных данных (вход не нужен):
`adb shell am start -n ru.combogame.yamodsync/.debug.ShowcaseActivity -e screen home`
(`home`, `home-guest`, `collection`, `room`, `room-join`, `room-live` — настоящее ядро
и релей с ПК на `ws://10.0.2.2:8799`, `player`, `settings`).

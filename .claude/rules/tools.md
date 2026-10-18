# Инструменты проекта: когда что использовать

Используй инструмент сам, когда задача под него подходит, не дожидаясь просьбы. Не используй, когда не нужно.

## Context7 (MCP `context7`)
Документация библиотек: tokio, tungstenite, serde, React, Radix, Tailwind 4, Vite 7, Electron 38, Anime.js 4,
neverthrow, sonner, Bun. Подробности — `context7.md`. Версии бери из `Cargo.toml` и `mod/package.json`,
а не самые новые.

## GitHub (MCP `github`)
- Репозиторий — `ComboGame/YaMod-Sync`. Перед первым вызовом в сессии — `get_me`.
- Без вопросов можно только читать: статус и логи Actions (CI, release), релизы, issues, PR, поиск по коду.
- Создавать, менять, комментировать, мержить, пушить файлы — только по прямой просьбе пользователя.
- Пушит пользователь сам (`git push` из этого терминала не проходит — нет входа в GitHub).
  После пуша — проверить, что workflow прошёл, и сказать, где релиз.

## Playwright (MCP `playwright`)
Обычные веб-страницы: проверить сайт, документацию, страницу релиза в браузере. Клиент Яндекс Музыки —
не через Playwright, а через CDP-скрипты (`--remote-debugging-port=9333`, см. CLAUDE.md), с ограничениями
из CLAUDE.md (закрытая установленная копия, локальный релей, без настоящей комнаты).

## Superpowers (скиллы `superpowers:*`)
- Новая функция или заметная переделка — `brainstorming`, потом `writing-plans`.
- Баг синхрона или сборки — `systematic-debugging` до любых правок.
- Поведение ядра или релея — `test-driven-development`: сначала тест, который падает (стиль тестов — в CLAUDE.md).
- Перед словами «готово» или «работает» — `verification-before-completion`: `cargo +1.99.1 test --workspace`,
  проверка типов TS, живая проверка, если менялось поведение в клиенте.
- Мелкая правка в пару строк — без скиллов.

## Frontend Design (скилл `frontend-design:frontend-design`)
Новый или переделанный интерфейс мода (`mod/src/mod/features/ui/**`, тема `modrinth.css`). Рамки
не меняются: токены `--ms-*` (OLED Modrinth), shadcn/Radix в Shadow DOM, Anime.js 150–250 мс,
тексты по-русски. Правка отступа или текста — без скилла.

## Диагностика (rust-analyzer, TypeScript в VS Code)
После правок в `crates/**` или `mod/src/**` — `mcp__claude-vscode__getDiagnostics` по изменённым
файлам, ошибки исправить до отчёта. rust-analyzer работает на тулчейне 1.99.1 (`.vscode/settings.json`).
Диагностика не заменяет `cargo test` и временный `tsc` из CLAUDE.md.

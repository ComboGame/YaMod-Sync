#!/usr/bin/env bash
# Автообновление релея на VDS из GitHub. Запускается таймером systemd
# (deploy/ymsync-update.timer) или руками: bash deploy/auto-update.sh
#
# Подтягивает main и пересобирает контейнер, только если с последней удачной
# сборки поменялось что-то, из чего собирается релей. Пуш с одними правками мода
# релей не трогает: перезапуск сбрасывает очереди комнат.
set -euo pipefail

cd "$(dirname "$0")/.."
branch="${YMSYNC_BRANCH:-main}"
# Коммит, из которого собран работающий контейнер. Хранится в .git, чтобы
# неудачная сборка повторилась в следующий раз, а не забылась вместе с pull.
state=".git/ymsync-deployed"

git fetch --quiet origin "$branch"
# Только вперёд: правки, сделанные прямо на сервере, не затираются — скрипт
# остановится с ошибкой, и её будет видно в journalctl.
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$branch")" ]; then
  git merge --ff-only --quiet "origin/$branch"
fi
head=$(git rev-parse HEAD)

deployed=$(cat "$state" 2>/dev/null || true)
if [ "$deployed" = "$head" ]; then
  exit 0
fi

relay_paths='^(crates/(proto|relay)/|Cargo\.(toml|lock)$|Dockerfile$|\.dockerignore$|docker-compose\.yml$|deploy/(Caddyfile|nginx-ymsync\.conf)$)'
if [ -n "$deployed" ] && git cat-file -e "$deployed" 2>/dev/null \
  && ! git diff --name-only "$deployed" "$head" | grep -qE "$relay_paths"; then
  echo "новые коммиты релея не касаются: $(git log --oneline -1)"
  echo "$head" > "$state"
  exit 0
fi

echo "обновляю релей до $(git log --oneline -1)"
# Профиль tls берётся из COMPOSE_PROFILES в .env.
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null
echo "$head" > "$state"

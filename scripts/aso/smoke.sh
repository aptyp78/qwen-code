#!/bin/sh
# Дымовые проверки перед промоушеном.
#
# Это НЕ юнит-тесты. У upstream их 2306, и они проверяют его инварианты, а не
# то, что владелец может работать. Здесь проверяется ровно то, чем он
# пользуется каждый день — на реальной собранной сборке, а не в песочнице.
#
# Использование:  sh scripts/aso/smoke.sh [канал]     (по умолчанию edge)

set -u

CHANNEL="${1:-edge}"
ROOT="$HOME/.qwen-aso"
CLI="$ROOT/channels/$CHANNEL/dist/cli.js"
NODE="$ROOT/node"
PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

if [ ! -e "$CLI" ]; then
  echo "Канал $CHANNEL пуст: $CLI" >&2
  exit 1
fi

run() { "$NODE" --expose-gc "$CLI" "$@" 2>&1; }

head_ "Дым по каналу $CHANNEL"

# 1. Запускается вообще и сообщает версию.
V=$(run --version | tail -1)
case "$V" in
  [0-9]*) ok "запускается, версия $V" ;;
  *)      bad "не сообщает версию" "$V" ;;
esac

# 2. Идёт под Node 22. Требование engines.node >= 22; под Node 20 продукт
#    даёт «spawn EBADF» — на этой машине nvm default именно 20.
NV=$("$NODE" --version)
case "$NV" in
  v2[2-9]*) ok "Node $NV" ;;
  *)        bad "Node $NV — продукт требует >= 22" ;;
esac

# 3. Видит настроенные MCP-серверы владельца.
if run mcp list >/dev/null 2>&1; then
  ok "перечисляет MCP-серверы"
else
  bad "не смог перечислить MCP-серверы"
fi

# 4. Видит расширения.
if run extensions list >/dev/null 2>&1; then
  ok "перечисляет расширения"
else
  bad "не смог перечислить расширения"
fi

# 5. Живая сессия с моделью — главный сценарий. Всё остальное может быть
#    зелёным при полностью неработающем инструменте.
ANS=$(run --prompt "Ответь ровно одним словом: работает" 2>&1 | tail -3)
case "$ANS" in
  *[Рр]аботает*) ok "живая сессия с моделью отвечает" ;;
  *)             bad "модель не ответила" "$(echo "$ANS" | head -2)" ;;
esac

head_ "Итог"
printf '  прошло: %s, провалено: %s\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1

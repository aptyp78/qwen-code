---
description: Устав форка — что это за репозиторий и какие правила обязательны
---

Это форк `aptyp78/qwen-code`, а не upstream `QwenLM/qwen-code`.

**Закон нулевого касания: наш код не смешивается с их кодом.** Оригинал
выпускает ~254 коммита в неделю; наша правка в их файле будет конфликтовать
почти при каждом обновлении.

Решай задачу на минимально возможном уровне:
`settings.json` → расширение `aso/extension/` → свой пакет `aso/packages/` →
`patches/` → и только потом правка файла upstream.

Свободно: `aso/**`, `.qwen/{rules,skills,agents,commands}/**`, `.claude/**`.
Новые файлы можно класть в холодные подсистемы ядра: `prompts`, `mcp`,
`providers`, `models`, `hooks`, `memory`.

Нельзя без регистрации в `aso/intrusions.json`: любой файл upstream.
Нельзя вообще: `aso/ownership.json`, `aso/intrusions.json`, `scripts/aso/**`,
`.husky/**`, коммиты в `main` и `stable`, `--force`, `--no-verify`.

Проверка перед «готово»: `node scripts/aso/cli.js check`.
Полные правила: `aso/RULES.md`.

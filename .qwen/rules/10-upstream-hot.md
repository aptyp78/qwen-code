---
description: Горячие файлы upstream — правка только через реестр вторжений
paths:
  - packages/core/src/config/config.ts
  - packages/cli/src/config/settingsSchema.ts
  - packages/core/src/index.ts
  - packages/cli/src/ui/AppContainer.tsx
  - packages/cli/src/ui/hooks/useGeminiStream.ts
  - packages/core/src/core/coreToolScheduler.ts
  - packages/core/src/core/client.ts
  - packages/cli/src/serve/server.ts
  - packages/cli/src/acp-integration/acpAgent.ts
  - packages/web-shell/client/App.tsx
---

Ты открыл один из самых горячих файлов upstream: 100–180 правок за квартал.

Правка здесь конфликтует почти при каждом слиянии и её стоимость платится
вечно. Прежде чем менять хоть строку:

1. Можно ли решить это настройкой в `settings.json`?
2. Можно ли — расширением в `aso/extension/` (команды, скиллы, хуки, MCP)?
3. Можно ли — своим пакетом в `aso/packages/` через MCP или SDK?

Если ни одно не подходит, правка допустима только внутри маркеров
`// FORK:BEGIN <якорь>` … `// FORK:END <якорь>` и только после записи
в `aso/intrusions.json`, которую одобряет владелец:

```
node scripts/aso/cli.js intrude <путь>
```

Попытка сохранить файл без записи будет отклонена автоматически.

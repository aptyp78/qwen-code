#!/usr/bin/env node
/**
 * Подключает паспорт и приёмку к .qwen/settings.json.
 *
 * Отдельным скриптом, а не правкой файла в коммите: settings.json — зона
 * aso-meta, её правит владелец осознанно, под ASO_META=1. Скрипт добавляет
 * только недостающее и повторным запуском ничего не меняет.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const путь = '.qwen/settings.json';
if (!existsSync(путь)) { console.error(`нет ${путь} — запускать из корня репозитория`); process.exit(1); }

const настройки = JSON.parse(readFileSync(путь, 'utf8'));
const хуки = (настройки.hooks ??= {});

const нужные = {
  SubagentStart: { name: 'aso-pasport', command: 'node $QWEN_PROJECT_DIR/.qwen/hooks/pasport.mjs', timeout: 5000 },
  SubagentStop: { name: 'aso-priyomka', command: 'node $QWEN_PROJECT_DIR/.qwen/hooks/priyomka.mjs', timeout: 10000 },
};

let добавлено = 0;
for (const [событие, хук] of Object.entries(нужные)) {
  const группы = (хуки[событие] ??= []);
  const есть = группы.some((г) => (г.hooks ?? []).some((х) => х.name === хук.name));
  if (есть) { console.log(`= ${событие}: ${хук.name} уже подключён`); continue; }
  группы.push({ hooks: [{ type: 'command', ...хук }] });
  console.log(`+ ${событие}: ${хук.name} подключён`);
  добавлено++;
}

if (!добавлено) { console.log('\nничего менять не нужно'); process.exit(0); }

// Бэкап до записи: файл боевой, им работает владелец каждый день.
copyFileSync(путь, `${путь}.bak-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
writeFileSync(путь, JSON.stringify(настройки, null, 2) + '\n');
JSON.parse(readFileSync(путь, 'utf8')); // проверка валидности после записи
console.log(`\n✓ записано, бэкап рядом. Проверить: node .qwen/hooks/svodka.mjs`);

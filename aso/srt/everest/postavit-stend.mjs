#!/usr/bin/env node
/**
 * Ставит стенд разбора книги ВНЕ репозитория.
 *
 * Репозиторий публичный, а материал — текст книги под копирайтом. Поэтому
 * конструкция (позиция, хуки, настройки) живёт в репозитории и версионируется,
 * а материал и прогон — в ~/materialy/everest/stend. Скрипт сводит одно с
 * другим и повторным запуском ничего не портит.
 *
 * Следы прогона при этом не теряются: паспорта и приёмка пишутся в
 * ~/.qwen/projects/**, то есть в домашний каталог, а не во временный.
 */
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const РЕПО = join(homedir(), 'ai-projects', 'qwen-code');
const СТЕНД = join(homedir(), 'materialy', 'everest', 'stend');
const ФРАГМЕНТЫ = join(homedir(), 'materialy', 'everest', 'fragmenty.json');

if (!existsSync(ФРАГМЕНТЫ)) {
  console.error(`нет материала: ${ФРАГМЕНТЫ}`);
  process.exit(1);
}

mkdirSync(join(СТЕНД, '.qwen', 'agents'), { recursive: true });
mkdirSync(join(СТЕНД, 'otryvki'), { recursive: true });

// Позиция берётся ссылкой, а не копией.
//
// Первая редакция копировала. Копия отстала при первой же правке канона:
// позиции добавили вторую обязанность, стенд продолжал работать по старому
// определению, и приёмка молча проверяла не то, что объявлено. Обнаружено
// проверкой, которая должна была отклонить — и приняла.
//
// Дисциплина «не забывать перепоставлять стенд» тут не годится: она такая же
// норма в голове, как все прочие, которые за эти сутки срабатывали через раз.
// Ссылка делает расхождение невозможным, а не маловероятным.
const позиция = join(СТЕНД, '.qwen', 'agents', 'vydelitel.md');
if (existsSync(позиция)) rmSync(позиция);
symlinkSync(join(РЕПО, '.qwen', 'agents', 'vydelitel.md'), позиция);

// Хуки — по абсолютному пути в репозиторий: стенд не должен держать их копию,
// иначе разойдутся редакции, а следы лягут рядом с копией.
const настройки = {
  hooks: {
    SubagentStart: [{ hooks: [{ type: 'command', name: 'aso-pasport',
      command: `node ${join(РЕПО, '.qwen', 'hooks', 'pasport.mjs')}`, timeout: 5000 }] }],
    SubagentStop: [{ hooks: [{ type: 'command', name: 'aso-priyomka',
      command: `node ${join(РЕПО, '.qwen', 'hooks', 'priyomka.mjs')}`, timeout: 15000 }] }],
  },
  $version: 4,
};
writeFileSync(join(СТЕНД, '.qwen', 'settings.json'),
  JSON.stringify(настройки, null, 2) + '\n');

const отрывки = JSON.parse(readFileSync(ФРАГМЕНТЫ, 'utf8'));
отрывки.forEach((текст, i) => {
  writeFileSync(join(СТЕНД, 'otryvki', `${String(i + 1).padStart(2, '0')}.txt`), текст);
});

console.log(`стенд: ${СТЕНД}`);
console.log(`позиция: vydelitel (приёмка на цитату)`);
console.log(`отрывков: ${отрывки.length}`);
console.log(`\nзапуск из стенда:\n  qwen -m gemma4:12b-mlx -p "<поручение>"`);

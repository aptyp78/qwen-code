#!/usr/bin/env node
/**
 * Сверка паспортов с журналом приёмки: не отказала ли приёмка молча.
 *
 * Сломанный хук приёмки не останавливает работу — и не оставляет следа.
 * Ответ проходит так, будто правила не было. Паспорт пишется до работы и
 * знает, какое правило объявлено; значит «правило объявлено, а записи приёмки
 * нет» — обнаружимо машинно.
 *
 * Запуск: node .qwen/hooks/svodka.mjs [каталог проекта в ~/.qwen/projects]
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const корень = join(homedir(), '.qwen', 'projects');
const цель = process.argv[2];

const журналПриёмки = join(dirname(fileURLToPath(import.meta.url)), 'priyomka.log');
// Сверка идёт по идентификатору агента, а не по типу: след от другого запуска
// той же позиции засчитывался бы за этот и давал ложное благополучие.
const отработавшие = new Set();
if (existsSync(журналПриёмки)) {
  for (const строка of readFileSync(журналПриёмки, 'utf8').split('\t\n').join('\n').split('\n')) {
    const [, id] = строка.split('\t');
    if (id && id !== '?') отработавшие.add(id);
  }
}

const проекты = цель ? [цель] : (existsSync(корень) ? readdirSync(корень) : []);
let всего = 0, немых = 0;

for (const проект of проекты) {
  const каталог = join(корень, проект, 'subagents');
  if (!existsSync(каталог)) continue;
  for (const сессия of readdirSync(каталог)) {
    const путь = join(каталог, сессия);
    for (const файл of readdirSync(путь).filter((f) => f.endsWith('.pasport.json'))) {
      let п;
      try { п = JSON.parse(readFileSync(join(путь, файл), 'utf8')); } catch { continue; }
      const правила = п.рамка?.обязанностиОтМашины ?? [];
      if (!правила.length) continue;
      всего++;
      if (!отработавшие.has(п.агент)) {
        немых++;
        console.log(`✗ ${п.позиция.padEnd(12)} ${п.агент.slice(0, 26).padEnd(28)} приёмка не отработала  ${п.время}`);
      }
    }
  }
}

console.log(`\nпозиций с объявленной приёмкой: ${всего}, без следа приёмки: ${немых}`);
process.exit(немых ? 1 : 0);

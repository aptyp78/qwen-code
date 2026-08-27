#!/usr/bin/env node
/**
 * Паспорт позиции: фиксирует рамку, в которой работал субагент.
 *
 * Журнал субагента содержит операции, материал и продукт, но не содержит
 * рамку: в нём нет ни системного промпта, ни обязанности, наложенной хуком.
 * Разбирая чужую работу по журналу, второй агент не увидит, в чьей позиции
 * работал первый и что тот был обязан сделать. Паспорт закрывает эту дыру.
 *
 * Пишется на старте, а не на завершении: агент может упасть, а рамка, в
 * которой он работал, всё равно должна остаться.
 *
 * Хеш определения нужен потому, что определения агентов меняются. Без него
 * старый журнал будет читаться сегодняшней обязанностью, и разбор соврёт.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { найтиОпределение, разобрать } from './lib.mjs';

const ХЕШ = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

function читатьJson(путь) {
  try { return JSON.parse(readFileSync(путь, 'utf8')); } catch { return {}; }
}

/** Обязанности, наложенные машиной: хуки приёмки из настроек. */
function обязанностиОтМашины(cwd) {
  const из = [];
  for (const корень of [cwd, homedir()]) {
    const s = читатьJson(join(корень, '.qwen', 'settings.json'));
    for (const группа of s?.hooks?.SubagentStop ?? []) {
      for (const h of группа.hooks ?? []) if (h.command) из.push(h.command);
    }
  }
  return [...new Set(из)];
}

let сырое = '';
process.stdin.on('data', (c) => (сырое += c));
process.stdin.on('end', () => {
  let вход = {};
  try { вход = JSON.parse(сырое); } catch { process.exit(0); }

  const { agent_id: id, agent_type: тип, session_id: сессия, cwd = process.cwd() } = вход;
  if (!id || !вход.transcript_path) process.exit(0);

  // Журналы субагентов лежат рядом с чатами родителя:
  // <projectDir>/chats/<sessionId>.jsonl  и  <projectDir>/subagents/<sessionId>/
  const каталогПроекта = dirname(dirname(resolve(вход.transcript_path)));
  const каталог = join(каталогПроекта, 'subagents', сессия ?? '');

  const опр = найтиОпределение(тип, cwd);
  const { поля, тело: обязанность } = опр ? разобрать(опр.текст) : { поля: {}, тело: null };
  const настройки = читатьJson(join(cwd, '.qwen', 'settings.json'));
  const общие = читатьJson(join(homedir(), '.qwen', 'settings.json'));

  const паспорт = {
    позиция: тип,
    агент: id,
    родительскаяСессия: сессия,
    время: вход.timestamp ?? new Date().toISOString(),
    рамка: {
      обязанностьИзОпределения: обязанность,
      // Правило приёмки объявляет сама позиция. Без этого поля сверка не может
      // отличить «позиция обязана» от «у машины настроен хук»: первая редакция
      // сверяла по хукам и записывала в нарушители позицию без правила, которая
      // справедливо прошла без вмешательства.
      правилоПриёмки: поля.priyomka ?? null,
      обязанностиОтМашины: обязанностиОтМашины(cwd),
    },
    средства: {
      инструментыРазрешены: поля.tools ?? '(все родительские)',
      корпус: опр?.путь ?? '(определение не найдено)',
    },
    машина: {
      модель: поля.model ?? настройки?.model?.name ?? общие?.model?.name ?? '(родительская)',
      адрес: настройки?.model?.baseUrl ?? общие?.model?.baseUrl ?? null,
    },
    хешОпределения: опр ? ХЕШ(опр.текст) : null,
  };

  try {
    mkdirSync(каталог, { recursive: true });
    writeFileSync(join(каталог, `agent-${id}.pasport.json`),
      JSON.stringify(паспорт, null, 2) + '\n');
  } catch { /* паспорт не должен ломать работу агента */ }
  process.exit(0);
});

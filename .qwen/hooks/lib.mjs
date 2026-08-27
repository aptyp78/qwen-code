/**
 * Общее для хуков: чтение определения позиции.
 *
 * Вынесено из priyomka и pasport, чтобы они не разошлись в понимании того,
 * где лежит определение и как оно устроено: два хука, читающие одно и то же
 * по-разному, рано или поздно дадут расхождение между паспортом и приёмкой.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Определение позиции: сначала проектное, потом пользовательское. */
export function найтиОпределение(тип, cwd) {
  for (const корень of [cwd, homedir()]) {
    const путь = join(корень, '.qwen', 'agents', `${тип}.md`);
    if (existsSync(путь)) return { путь, текст: readFileSync(путь, 'utf8') };
  }
  return null;
}

export function разобрать(текст) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(текст);
  if (!m) return { поля: {}, тело: текст.trim() };
  const поля = {};
  for (const строка of m[1].split('\n')) {
    const [, k, v] = /^([a-zA-Z_]+):\s*(.*)$/.exec(строка) ?? [];
    if (k) поля[k] = v.trim();
  }
  return { поля, тело: m[2].trim() };
}

/** Материал: всё, что позиция получила от орудий за время работы. */
export function материалИзЖурнала(путь) {
  let текст = '';
  try {
    for (const строка of readFileSync(путь, 'utf8').split('\n')) {
      if (!строка.trim()) continue;
      let z;
      try { z = JSON.parse(строка); } catch { continue; }
      for (const part of z.message?.parts ?? []) {
        const r = part.functionResponse?.response;
        if (r) текст += ' ' + JSON.stringify(r);
      }
    }
  } catch { /* журнала может не быть — тогда сверять не с чем */ }
  return текст;
}

/**
 * Основа слова: первые пять букв. Русский склоняется, и точное сравнение
 * обманывается — «проекта» не находится там, где написано «Проект».
 * Обрезка грубая и склоняет к строгости: лучше отклонить лишний раз, чем
 * узаконить пустышку.
 */
export const основа = (слово) => (слово.length > 5 ? слово.slice(0, 5) : слово);

/**
 * @license
 * Copyright 2026 Arthur Ocheretny
 * SPDX-License-Identifier: Apache-2.0
 *
 * Общие примитивы для скриптов форка. Зависимостей нет намеренно: этот код
 * вызывается PreToolUse-хуком на каждой правке файла и обязан работать даже
 * при сломанном node_modules.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
export const ASO_DIR = join(REPO_ROOT, 'aso');

export function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', opts.quiet ? 'ignore' : 'pipe'],
  }).trim();
}

export function gitSafe(args, fallback = '') {
  try {
    return git(args, { quiet: true });
  } catch {
    return fallback;
  }
}

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Не найден файл: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Зоны с `source: "heat"` получают globs из сгенерированной карты горячих
 * файлов — рукописный список устаревает за квартал и начинает врать.
 */
export function loadOwnership() {
  const ownership = readJson(join(ASO_DIR, 'ownership.json'));
  for (const zone of ownership.zones) {
    if (zone.source === 'heat') {
      zone.globs = loadHeat().files.map((f) => f.path);
    }
  }
  return ownership;
}
export const loadHeat = () =>
  readJson(join(ASO_DIR, 'heat.json'), { files: [] });
export const loadIntrusions = () =>
  readJson(join(ASO_DIR, 'intrusions.json'), { intrusions: [] });

/**
 * Минимальный glob: поддерживает `**`, `*`, `?` и группы `{a,b}`.
 * Полноценный picomatch не берём — он тянет node_modules, а хук обязан
 * пережить их отсутствие.
 */
export function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` съедает любое число сегментов, включая ноль
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') out += '[^/]';
    else if (c === '{') out += '(?:';
    else if (c === '}') out += ')';
    else if (c === ',') out += '|';
    else if ('\\^$.|+()[]'.includes(c)) out += '\\' + c;
    else out += c;
  }
  return new RegExp('^' + out + '$');
}

const globCache = new Map();
export function matches(path, pattern) {
  let re = globCache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    globCache.set(pattern, re);
  }
  return re.test(path);
}

/** Первая зона, чей glob совпал. Порядок в ownership.json значим. */
export function zoneFor(path, ownership) {
  for (const zone of ownership.zones) {
    if (zone.globs.some((g) => matches(path, g))) return zone;
  }
  return { id: 'unknown', policy: 'registered', globs: [] };
}

export function mergeBase(ref = 'upstream/main') {
  const base = gitSafe(['merge-base', ref, 'HEAD']);
  if (!base) {
    throw new Error(`Нет общей базы с ${ref}. Выполни: git fetch upstream`);
  }
  return base;
}

/** Файлы, отличающиеся от базы upstream — фактическая дельта форка. */
export function changedSinceBase(ref = 'upstream/main') {
  return gitSafe(['diff', '--name-only', `${mergeBase(ref)}..HEAD`])
    .split('\n')
    .filter(Boolean);
}

export function stagedFiles() {
  return gitSafe(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    .split('\n')
    .filter(Boolean);
}

/**
 * Существует ли файл в базе upstream. Если нет — он наш собственный, и
 * конфликтовать при слиянии нечему. Это единственный честный признак: список
 * «наших» путей устаревает, а факт отсутствия у upstream — нет.
 */
export function existsAtBase(path, base) {
  if (!base) return true;
  try {
    git(['cat-file', '-e', `${base}:${path}`], { quiet: true });
    return true;
  } catch {
    return false;
  }
}

export function currentBranch() {
  return gitSafe(['rev-parse', '--abbrev-ref', 'HEAD'], 'HEAD');
}

const ESC = '\u001b[';
const paint = (code) => (s) =>
  process.stdout.isTTY ? `${ESC}${code}m${s}${ESC}0m` : String(s);

export const bold = paint('1');
export const red = paint('31');
export const green = paint('32');
export const yellow = paint('33');
export const dim = paint('2');

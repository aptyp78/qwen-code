/**
 * @license
 * Copyright 2026 Arthur Ocheretny
 * SPDX-License-Identifier: Apache-2.0
 *
 * Проверка границы форка: можно ли трогать этот файл и на каких условиях.
 *
 * Текст отказа здесь важнее любой документации. Агент с чистым контекстом,
 * не читавший ни строчки правил, узнаёт их ровно в тот момент, когда они ему
 * нужны — из того, что у него не получилось.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO_ROOT,
  gitSafe,
  loadOwnership,
  loadIntrusions,
  loadHeat,
  zoneFor,
  matches,
} from '../lib.js';

export const LADDER = `Лестница вторжения — пробуй по порядку, останавливайся на первом, что сработало:
  T0  settings.json          свои модели, MCP-серверы, хуки, разрешения      цена слияния: ноль
  T1  aso/extension/         команды, скиллы, субагенты, хуки, контекст      цена слияния: ноль
  T2  aso/packages/<имя>/    свой код, доступ через MCP или их SDK           цена слияния: ноль
  T3  patches/<пакет>.patch  правка чужой зависимости                        цена: только по ней
  T4  правка файла upstream  внутри // FORK:BEGIN <id> ... // FORK:END <id>  цена: конфликт при каждом слиянии`;

const REGISTER_HINT = (path) =>
  `Если ни одна ступень не подошла — покажи владельцу обоснование:\n  node scripts/aso/cli.js intrude ${path}`;

/** Номера строк пост-образа, затронутые диффом. */
function changedLines(path, { staged, base }) {
  const args = staged
    ? ['diff', '--cached', '-U0', '--', path]
    : ['diff', '-U0', `${base}..HEAD`, '--', path];
  const diff = gitSafe(args);
  const lines = new Set();
  for (const row of diff.split('\n')) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(row);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i++) lines.add(start + i);
  }
  return lines;
}

/** Диапазоны строк между маркерами FORK:BEGIN / FORK:END. */
export function anchorRanges(path) {
  const abs = join(REPO_ROOT, path);
  if (!existsSync(abs)) return [];
  const ranges = [];
  let open = null;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    const begin = /FORK:BEGIN\s+([\w.-]+)/.exec(line);
    const end = /FORK:END\s+([\w.-]+)/.exec(line);
    if (begin) open = { id: begin[1], from: idx + 1 };
    else if (end && open) {
      ranges.push({ ...open, to: idx + 1 });
      open = null;
    }
  });
  if (open) ranges.push({ ...open, to: lines.length, unterminated: true });
  return ranges;
}

function isNewFile(path, { staged, base }) {
  const range = staged
    ? ['diff', '--cached', '--diff-filter=A', '--name-only']
    : ['diff', '--diff-filter=A', '--name-only', `${base}..HEAD`];
  return gitSafe(range).split('\n').includes(path);
}

function heatOf(path, heat) {
  return heat.files.find((f) => f.path === path)?.touches ?? 0;
}

/**
 * Изменились ли выданные разрешения, а не просто файлы реестра.
 *
 * Смысл правила «политика отдельным изменением» — не дать выдать себе
 * разрешение тем же коммитом, которым им пользуются. Создание пустого реестра
 * или переформатирование ничего не разрешает и блокировать не должно.
 */
function grantsChanged(paths, ctx) {
  const readAt = (rev, file) => {
    const raw = gitSafe(['show', `${rev}:${file}`]);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  if (paths.includes('aso/intrusions.json')) {
    const before = readAt('HEAD', 'aso/intrusions.json')?.intrusions ?? [];
    const after = loadIntrusions().intrusions;
    if (JSON.stringify(before) !== JSON.stringify(after)) return true;
  }

  if (paths.includes('aso/ownership.json')) {
    const before = readAt('HEAD', 'aso/ownership.json');
    // Файла ещё не было — это установка механизма, а не расширение прав.
    if (before) {
      const after = loadOwnership();
      const strip = (o) =>
        JSON.stringify(o.zones.map((z) => [z.id, z.policy, z.globs]));
      if (strip(before) !== strip(after)) return true;
    }
  }

  void ctx;
  return false;
}

/**
 * @param {string[]} paths проверяемые пути
 * @param {{staged?: boolean, base?: string}} opts
 * @returns {{ok: boolean, violations: Array<{path: string, zone: string, message: string}>}}
 */
export function checkOwnership(paths, opts = {}) {
  const ownership = loadOwnership();
  const registry = loadIntrusions();
  const heat = loadHeat();
  const base =
    opts.base ?? gitSafe(['merge-base', ownership.upstreamRef, 'HEAD']);
  const ctx = { staged: Boolean(opts.staged), base };
  const violations = [];

  const touchesRegistry = grantsChanged(paths, ctx);
  const touchesOutsideFork = paths.some(
    (p) => !matches(p, 'aso/**') && !matches(p, 'scripts/aso/**'),
  );

  if (touchesRegistry && touchesOutsideFork) {
    violations.push({
      path: 'aso/intrusions.json',
      zone: 'aso-meta',
      message: [
        'Реестр вторжений изменён вместе с кодом вне каталога форка.',
        '',
        'Политика меняется только отдельным изменением. Иначе достаточно одного',
        'коммита, чтобы разрешить себе то, что запрещено, — и через месяц',
        'разрешено будет всё.',
        '',
        'Раздели на два: сначала изменение реестра, потом сама правка.',
      ].join('\n'),
    });
  }

  for (const path of paths) {
    const zone = zoneFor(path, ownership);
    const entry = registry.intrusions.find((i) => i.path === path);

    switch (zone.policy) {
      case 'free':
        break;

      case 'owner-only': {
        if (process.env.ASO_META === '1') break;
        // Учредительные швы уже приняты владельцем: в режиме полной дельты они
        // не должны срабатывать вечно. Новая правка того же файла проверяется
        // в staged-режиме и по-прежнему требует осознанного ASO_META=1.
        if (!ctx.staged && ownership.budget.wiringFiles.includes(path)) break;
        violations.push({
          path,
          zone: zone.id,
          message: [
            `${path} описывает сами правила форка и защищён от правки агентом.`,
            '',
            zone.why,
            '',
            'Если правка действительно нужна — её делает владелец, осознанно:',
            '  ASO_META=1 <команда>',
            'и коммит с трейлером  Fork-Meta: <причина>',
          ].join('\n'),
        });
        break;
      }

      case 'additive': {
        if (isNewFile(path, ctx) || entry) break;
        violations.push({
          path,
          zone: zone.id,
          message: [
            `${path} — холодная зона upstream: новые файлы сюда класть можно,`,
            'но правка существующего файла всё же требует записи в реестре.',
            '',
            REGISTER_HINT(path),
          ].join('\n'),
        });
        break;
      }

      case 'registered': {
        if (entry) break;
        violations.push({
          path,
          zone: zone.id,
          message: [
            `${path} принадлежит upstream и не зарегистрирован как вторжение.`,
            '',
            LADDER,
            '',
            REGISTER_HINT(path),
          ].join('\n'),
        });
        break;
      }

      case 'registered-anchored': {
        const touches = heatOf(path, heat);
        if (!entry) {
          violations.push({
            path,
            zone: zone.id,
            message: [
              `${path} — горячий файл upstream: ${touches} касаний за квартал.`,
              'Правка здесь будет конфликтовать почти при каждом слиянии.',
              '',
              LADDER,
              '',
              REGISTER_HINT(path),
            ].join('\n'),
          });
          break;
        }
        const ranges = anchorRanges(path);
        const unterminated = ranges.find((r) => r.unterminated);
        if (unterminated) {
          violations.push({
            path,
            zone: zone.id,
            message: `Якорь FORK:BEGIN ${unterminated.id} не закрыт парным FORK:END.`,
          });
          break;
        }
        const changed = [...changedLines(path, ctx)];
        const outside = changed.filter(
          (ln) => !ranges.some((r) => ln >= r.from && ln <= r.to),
        );
        if (outside.length) {
          violations.push({
            path,
            zone: zone.id,
            message: [
              `${path}: изменены строки вне якорей — ${outside.slice(0, 8).join(', ')}${outside.length > 8 ? ' …' : ''}.`,
              '',
              'В горячем файле каждая наша строка обязана лежать внутри',
              `// FORK:BEGIN ${entry.anchor} ... // FORK:END ${entry.anchor}`,
              'иначе слияние перестаёт быть механическим.',
            ].join('\n'),
          });
        }
        if (entry.maxLines && changed.length > entry.maxLines) {
          violations.push({
            path,
            zone: zone.id,
            message: `${path}: изменено ${changed.length} строк при лимите ${entry.maxLines} из реестра.`,
          });
        }
        if (entry.expires && new Date(entry.expires) < new Date()) {
          violations.push({
            path,
            zone: zone.id,
            message: [
              `Вторжение ${entry.id} просрочено (истекло ${entry.expires}).`,
              'Продли срок, отправь правку в upstream или сними её.',
            ].join('\n'),
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return { ok: violations.length === 0, violations };
}

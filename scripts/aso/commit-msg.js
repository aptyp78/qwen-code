#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Arthur Ocheretny
 * SPDX-License-Identifier: Apache-2.0
 *
 * Проверка сообщения коммита. Без commitlint: 60 строк своего кода дешевле
 * зависимости, которая всё равно потребует конфигурации при каждом слиянии.
 *
 * Трейлер Agent: обязателен, потому что через полгода при трёх агентских
 * стеках это единственный способ разобрать регрессию.
 */

import { readFileSync } from 'node:fs';

const TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'chore',
  'docs',
  'test',
  'build',
  'ci',
  'style',
  'revert',
];

const HEADER = new RegExp(
  `^(${TYPES.join('|')})(\\([a-z0-9./-]+\\))?!?: .{3,}$`,
);

const path = process.argv[2];
if (!path) {
  console.error('commit-msg: не передан путь к файлу сообщения');
  process.exit(2);
}

const raw = readFileSync(path, 'utf8');
const lines = raw.split('\n').filter((l) => !l.startsWith('#'));
const header = lines[0]?.trim() ?? '';
const body = lines.join('\n');

const problems = [];

if (header.startsWith('Merge ') || header.startsWith('Revert ')) {
  process.exit(0);
}

if (!HEADER.test(header)) {
  problems.push(
    [
      `Заголовок не по Conventional Commits: "${header}"`,
      '',
      `  Формат:  тип(область): описание`,
      `  Типы:    ${TYPES.join(', ')}`,
      `  Пример:  feat(cli): add --json flag to config get`,
    ].join('\n'),
  );
}

if (header.length > 100) {
  problems.push(`Заголовок длиннее 100 символов (${header.length}).`);
}

if (!/^Agent:\s*\S+/m.test(body)) {
  problems.push(
    [
      'Нет трейлера Agent: — непонятно, кто автор изменения.',
      '',
      '  Добавь строку в конец сообщения, например:',
      '    Agent: claude-opus-5',
      '    Agent: qwen',
      '    Agent: human:andrey',
    ].join('\n'),
  );
}

if (process.env.ASO_META === '1' && !/^Fork-Meta:\s*\S+/m.test(body)) {
  problems.push(
    [
      'Коммит правит сами правила форка (ASO_META=1), но нет трейлера Fork-Meta:.',
      '',
      '    Fork-Meta: <зачем меняем правила>',
    ].join('\n'),
  );
}

if (problems.length) {
  console.error('');
  console.error('  Сообщение коммита отклонено');
  console.error('');
  for (const p of problems) {
    console.error(
      p
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n'),
    );
    console.error('');
  }
  process.exit(1);
}

#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Arthur Ocheretny
 * SPDX-License-Identifier: Apache-2.0
 *
 * Адаптер хуков: один на все харнессы. Логика правил живёт в checks/, здесь
 * только нормализация входа и формат ответа — харнессов со временем станет
 * больше, а правила должны остаться в одном месте.
 *
 * Бюджет — 100 мс: хук вызывается на каждой правке файла. Поэтому никаких
 * импортов из packages/ и никакой зависимости от node_modules.
 */

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { relative, isAbsolute, join } from 'node:path';
import { checkOwnership } from './checks/ownership.js';
import { REPO_ROOT, currentBranch, loadHeat, loadIntrusions } from './lib.js';

const PROTECTED_BRANCHES = ['main', 'stable'];

/** Имена инструментов правки в разных харнессах. */
const EDIT_TOOLS = new Set([
  'edit',
  'write_file',
  'replace',
  'notebook_edit',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
]);

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function toRepoPath(candidate) {
  if (!candidate) return null;
  const rel = isAbsolute(candidate)
    ? relative(REPO_ROOT, candidate)
    : candidate;
  if (rel.startsWith('..')) return null; // вне репозитория — не наше дело
  return rel;
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

function allow() {
  process.stdout.write('{}');
}

function sessionContext() {
  const heat = loadHeat();
  const registry = loadIntrusions();
  return [
    'ФОРК aptyp78/qwen-code — не upstream. Правила обязательны и проверяются машиной.',
    '',
    `Ветка: ${currentBranch()}. Вторжений в upstream: ${registry.intrusions.length}.`,
    `Горячих файлов upstream: ${heat.files.length} (правка только по регистрации).`,
    '',
    'Свободно: aso/**, .qwen/{rules,skills,agents,commands}/**, .claude/**',
    'Нельзя вообще: aso/ownership.json, aso/intrusions.json, scripts/aso/**,',
    '  .husky/**, коммиты в main и stable, --force, --no-verify.',
    '',
    'Полные правила: aso/RULES.md. Сводка: node scripts/aso/cli.js brief',
  ].join('\n');
}

/**
 * Журнал вызовов. Нужен не для аудита, а чтобы отличить «хук отказал» от
 * «хук вообще не запустился»: upstream может в любой момент включить
 * TrustedHooksManager, и тогда хуки умрут молча.
 */
function logCall(event, tool, path, decision) {
  try {
    const dir = join(REPO_ROOT, 'aso', '.cache');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, 'hook.log'),
      `${new Date().toISOString()}\t${event}\t${tool}\t${path ?? '-'}\t${decision}\n`,
    );
  } catch {
    // журнал не должен ломать работу агента
  }
}

function main() {
  const input = readStdin();
  const event = input.hook_event_name ?? 'PreToolUse';

  if (event === 'SessionStart') {
    logCall(event, '-', null, 'context');
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: sessionContext(),
        },
      }),
    );
    return;
  }

  const toolName = input.tool_name ?? '';
  const toolInput = input.tool_input ?? {};

  if (toolName === 'run_shell_command' || toolName === 'Bash') {
    const cmd = String(toolInput.command ?? '');
    const branch = currentBranch();
    if (/\bgit\s+commit\b/.test(cmd) && PROTECTED_BRANCHES.includes(branch)) {
      deny(
        `Ветка ${branch} защищена от прямых коммитов.\n` +
          (branch === 'main'
            ? 'main — точное зеркало upstream; наш коммит здесь ломает вычисление общей базы.'
            : 'stable — то, из чего собран рабочий инструмент владельца.') +
          '\n\nРаботай в ветке от dev:  git switch -c feat/<задача> dev',
      );
      return;
    }
    if (/--no-verify|\s-n\b/.test(cmd) && /\bgit\s+commit\b/.test(cmd)) {
      deny(
        'Обход хуков запрещён: именно они удерживают границу форка.\n' +
          'Если проверка мешает по делу — исправь причину или объясни владельцу.',
      );
      return;
    }
    if (/\bgit\s+push\b.*(--force|\s-f\b)/.test(cmd)) {
      deny('git push --force запрещён: он способен стереть историю форка.');
      return;
    }
    allow();
    return;
  }

  if (!EDIT_TOOLS.has(toolName)) {
    allow();
    return;
  }

  const path = toRepoPath(toolInput.file_path ?? toolInput.path);
  if (!path) {
    allow();
    return;
  }

  const { ok, violations } = checkOwnership([path], { staged: true });
  logCall(event, toolName, path, ok ? 'allow' : 'deny');
  if (ok) {
    allow();
    return;
  }
  deny(
    'ОТКЛОНЕНО границей форка.\n\n' +
      violations.map((v) => v.message).join('\n\n'),
  );
}

main();

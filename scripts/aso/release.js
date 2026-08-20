#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Arthur Ocheretny
 * SPDX-License-Identifier: Apache-2.0
 *
 * Каналы поставки.
 *
 * Ключевая идея: владелец никогда не запускает сборку — он запускает
 * распакованный снимок. Поэтому состояние репозитория физически не может
 * сломать его рабочий инструмент, а откат сводится к перевеске симлинка.
 *
 * Запуск идёт мимо `scripts/cli-entry.js` намеренно: там живёт механика
 * самообновления, которая ставит upstream-версию поверх нашей сборки.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
  chmodSync,
  cpSync,
  realpathSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  REPO_ROOT,
  git,
  gitSafe,
  bold,
  green,
  red,
  dim,
  yellow,
} from './lib.js';

export const ASO_HOME = join(homedir(), '.qwen-aso');
const RELEASES = join(ASO_HOME, 'releases');
const CHANNELS = join(ASO_HOME, 'channels');
const BIN = join(ASO_HOME, 'bin');
const HISTORY = join(ASO_HOME, 'history.log');
const KEEP_RELEASES = 5;

/** Абсолютный путь к Node 22. Активная версия nvm ненадёжна: default = 20. */
export function findNode22() {
  const nvm = join(homedir(), '.nvm', 'versions', 'node');
  if (existsSync(nvm)) {
    const v22 = readdirSync(nvm)
      .filter((v) => v.startsWith('v22.'))
      .sort()
      .pop();
    if (v22) return join(nvm, v22, 'bin', 'node');
  }
  if (Number(process.versions.node.split('.')[0]) >= 22)
    return process.execPath;
  throw new Error(
    'Не найден Node 22. Продукт требует engines.node >= 22, а nvm default = 20.',
  );
}

function relink(linkPath, target) {
  mkdirSync(join(linkPath, '..'), { recursive: true });
  if (existsSync(linkPath)) unlinkSync(linkPath);
  symlinkSync(target, linkPath);
}

function readLink(name) {
  const p = join(CHANNELS, name);
  if (!existsSync(p)) return null;
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function log(line) {
  mkdirSync(ASO_HOME, { recursive: true });
  appendFileSync(HISTORY, `${new Date().toISOString()}\t${line}\n`);
}

function upstreamVersion() {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
    .version;
}

function nextSerial() {
  if (!existsSync(RELEASES)) return 1;
  const serials = readdirSync(RELEASES)
    .map((d) => Number(/\+aso\.(\d+)$/.exec(d)?.[1]))
    .filter((n) => Number.isFinite(n));
  return serials.length ? Math.max(...serials) + 1 : 1;
}

function pruneReleases() {
  if (!existsSync(RELEASES)) return;
  const inUse = new Set(
    ['stable', 'edge', 'previous'].map((c) => readLink(c)).filter(Boolean),
  );
  const dirs = readdirSync(RELEASES)
    .map((d) => ({ d, n: Number(/\+aso\.(\d+)$/.exec(d)?.[1]) || 0 }))
    .sort((a, b) => b.n - a.n)
    .slice(KEEP_RELEASES);
  for (const { d } of dirs) {
    const full = join(RELEASES, d);
    if (inUse.has(full)) continue;
    rmSync(full, { recursive: true, force: true });
    log(`prune\t${d}`);
  }
}

export function cmdBuild() {
  const node = findNode22();
  const nodeBin = join(node, '..');
  const env = { ...process.env, PATH: `${nodeBin}:${process.env.PATH}` };

  console.log(dim(`Node: ${node}`));
  console.log('Сборка (build + bundle)…');
  execFileSync('npm', ['run', 'build'], {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
  });
  execFileSync('npm', ['run', 'bundle'], {
    cwd: REPO_ROOT,
    env,
    stdio: 'inherit',
  });

  const version = `${upstreamVersion()}+aso.${nextSerial()}`;
  const target = join(RELEASES, version);
  mkdirSync(target, { recursive: true });
  cpSync(join(REPO_ROOT, 'dist'), join(target, 'dist'), { recursive: true });
  writeFileSync(
    join(target, 'release.json'),
    JSON.stringify(
      {
        version,
        upstreamVersion: upstreamVersion(),
        commit: gitSafe(['rev-parse', 'HEAD']),
        branch: gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']),
        builtWithNode: process.versions.node,
        node,
      },
      null,
      2,
    ) + '\n',
  );

  relink(join(CHANNELS, 'edge'), target);
  log(`build\t${version}\tedge`);
  pruneReleases();

  console.log('');
  console.log(`${green('✓')} собрано ${bold(version)}`);
  console.log(dim(`  ${target}`));
  console.log(
    dim('  канал edge переведён на эту сборку — проверяй командой qqx'),
  );
  return 0;
}

export function cmdWrappers() {
  const node = findNode22();
  mkdirSync(BIN, { recursive: true });
  relink(join(ASO_HOME, 'node'), node);

  for (const [name, channel] of [
    ['qq', 'stable'],
    ['qqx', 'edge'],
  ]) {
    const script = [
      '#!/bin/sh',
      '# Обёртка канала форка qwen-code.',
      '# Node прибит абсолютным путём: активная версия nvm на этой машине — 20,',
      '# а продукт требует >= 22. Полагаться на PATH здесь нельзя.',
      '',
      '# Секреты приходят из Keychain в момент запуска, а не лежат в конфиге:',
      '# ~/.qwen/settings.json читается процессами пользователя и попадает в',
      '# бэкапы, Keychain — нет.',
      '#',
      '# OPENAI_API_KEY подменяется ТОЛЬКО в этом процессе: qwen-code 0.21.x',
      '# авторизует все openai-провайдеры одним ключом из security.auth.apiKey',
      '# или OPENAI_API_KEY, а apiKey/envKey внутри modelProviders[] для',
      '# авторизации не читает. В окружении лежит настоящий ключ OpenAI, и',
      '# Alibaba отвергала его с 401 — облачные модели молчали, локальные',
      '# работали лишь потому, что Ollama ключ не проверяет.',
      '_tp=$(security find-generic-password -a "$USER" -s bailian_token_plan_api_key -w 2>/dev/null)',
      'if [ -n "$_tp" ]; then',
      '  BAILIAN_TOKEN_PLAN_API_KEY="$_tp"; export BAILIAN_TOKEN_PLAN_API_KEY',
      '  OPENAI_API_KEY="$_tp";              export OPENAI_API_KEY',
      'else',
      '  echo "qwen: ключ bailian_token_plan_api_key не найден в Keychain — облако даст 401" >&2',
      'fi',
      'unset _tp',
      '# baseUrl берётся из настроек провайдера; переменная из ~/.zshrc увела бы',
      '# все запросы на чужой эндпоинт.',
      'unset OPENAI_BASE_URL',
      '',
      `CH="$HOME/.qwen-aso/channels/${channel}"`,
      'if [ ! -e "$CH" ]; then',
      `  echo "Канал ${channel} пуст. Собери: node scripts/aso/release.js build" >&2`,
      '  exit 1',
      'fi',
      'exec "$HOME/.qwen-aso/node" --expose-gc "$CH/dist/cli.js" "$@"',
      '',
    ].join('\n');
    const path = join(BIN, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }

  console.log(
    `${green('✓')} обёртки готовы: ${join(BIN, 'qq')}, ${join(BIN, 'qqx')}`,
  );
  console.log(dim(`  Node прибит: ${node}`));
  console.log('');
  console.log('Добавь в ~/.zshrc, если ещё не добавлено:');
  console.log(bold(`  export PATH="$HOME/.qwen-aso/bin:$PATH"`));
  return 0;
}

export function cmdPromote() {
  const edge = readLink('edge');
  if (!edge) {
    console.error(
      'Канал edge пуст. Сначала: node scripts/aso/release.js build',
    );
    return 1;
  }
  const current = readLink('stable');
  if (current === edge) {
    console.log('stable уже указывает на эту сборку.');
    return 0;
  }

  // stable обязана оставаться предком dev, иначе откат превращается в раскопки.
  const branch = gitSafe(['rev-parse', '--abbrev-ref', 'HEAD']);
  try {
    git(['switch', 'stable']);
    git(['merge', '--ff-only', 'dev']);
  } finally {
    gitSafe(['switch', branch]);
  }

  if (current) relink(join(CHANNELS, 'previous'), current);
  relink(join(CHANNELS, 'stable'), edge);

  const version = edge.split('/').pop();
  const tag = `aso-${/\+aso\.(\d+)$/.exec(version)?.[1] ?? 'x'}`;
  gitSafe(['tag', '-f', tag, 'stable']);
  log(`promote\t${version}\t${tag}`);

  console.log(
    `${green('✓')} stable → ${bold(version)}  ${dim(`(тег ${tag})`)}`,
  );
  console.log(dim('  откат: node scripts/aso/release.js rollback'));
  return 0;
}

export function cmdRollback(args) {
  const explicit = args[0];
  const target = explicit ? join(RELEASES, explicit) : readLink('previous');

  if (!target || !existsSync(target)) {
    console.error(
      explicit
        ? `Нет такой сборки: ${explicit}`
        : 'Нет предыдущей сборки для отката.',
    );
    return 1;
  }
  const current = readLink('stable');
  if (current) relink(join(CHANNELS, 'previous'), current);
  relink(join(CHANNELS, 'stable'), target);
  log(`rollback\t${target.split('/').pop()}`);
  console.log(
    `${green('✓')} stable → ${bold(target.split('/').pop())} ${dim('(откат)')}`,
  );
  return 0;
}

export function cmdStatus() {
  console.log('');
  console.log(bold('Каналы поставки'));
  console.log('');
  for (const ch of ['stable', 'edge', 'previous']) {
    const link = readLink(ch);
    const name = link ? link.split('/').pop() : dim('— пусто');
    const mark = ch === 'stable' ? green('●') : dim('○');
    console.log(`  ${mark} ${ch.padEnd(9)} ${name}`);
  }
  console.log('');
  const node = existsSync(join(ASO_HOME, 'node'))
    ? realpathSync(join(ASO_HOME, 'node'))
    : null;
  console.log(`  node       ${node ?? red('не прибит — запусти wrappers')}`);
  console.log(
    `  обёртки    ${existsSync(join(BIN, 'qq')) ? join(BIN, 'qq') : red('нет')}`,
  );
  console.log(
    `  в PATH     ${(process.env.PATH ?? '').includes(BIN) ? green('да') : yellow('нет — добавь export PATH="$HOME/.qwen-aso/bin:$PATH"')}`,
  );
  console.log('');
  return 0;
}

const commands = {
  build: cmdBuild,
  wrappers: cmdWrappers,
  promote: cmdPromote,
  rollback: cmdRollback,
  status: cmdStatus,
};

if (process.argv[1] && process.argv[1].endsWith('release.js')) {
  const [, , command = 'status', ...rest] = process.argv;
  const handler = commands[command];
  if (!handler) {
    console.error(`Неизвестная команда: ${command}`);
    console.error(`Доступны: ${Object.keys(commands).join(', ')}`);
    process.exit(2);
  }
  process.exit(handler(rest));
}

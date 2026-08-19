#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Arthur Ocheretny
 * SPDX-License-Identifier: Apache-2.0
 *
 * Единая точка входа для рутин форка.
 *   brief   — где я и что можно (первые 60 секунд сессии агента)
 *   check   — проверка границы: --staged | --range
 *   heat    — пересчитать карту горячих файлов upstream
 *   drift   — фактическая дельта форка против реестра
 *   intrude — регистрация вторжения (пишет только владелец, интерактивно)
 */

import { checkOwnership, LADDER } from './checks/ownership.js';
import { writeHeat } from './heat.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  REPO_ROOT as REPO_ROOT_LOCAL,
  git,
  bold,
  red,
  green,
  yellow,
  dim,
  currentBranch,
  changedSinceBase,
  stagedFiles,
  gitSafe,
  loadOwnership,
  loadIntrusions,
  loadHeat,
  matches,
  mergeBase,
  existsAtBase,
} from './lib.js';

const PROTECTED_BRANCHES = ['main', 'stable'];

function reportViolations(violations) {
  console.error('');
  console.error(red(bold('  Граница форка: изменение отклонено  ')));
  console.error('');
  for (const v of violations) {
    console.error(`${red('✗')} ${bold(v.path)}  ${dim(`[зона ${v.zone}]`)}`);
    console.error(
      v.message
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n'),
    );
    console.error('');
  }
  console.error(dim('Полные правила: aso/RULES.md'));
  console.error('');
}

function cmdCheck(args) {
  const staged = args.includes('--staged');
  const paths = staged ? stagedFiles() : changedSinceBase();

  if (!paths.length) {
    console.log(green('✓') + ' нечего проверять');
    return 0;
  }

  const branch = currentBranch();
  if (PROTECTED_BRANCHES.includes(branch)) {
    console.error('');
    console.error(
      red(bold(`  Ветка ${branch} защищена от прямых изменений  `)),
    );
    console.error('');
    console.error(
      branch === 'main'
        ? '  main — точное зеркало upstream. Любой наш коммит здесь ломает\n  вычисление общей базы, на котором стоит вся проверка границы.'
        : '  stable — то, из чего собран рабочий инструмент владельца.\n  Она двигается только промоушеном, чтобы откат оставался возможен.',
    );
    console.error('');
    console.error('  Работай в ветке от dev:  git switch -c feat/<задача> dev');
    console.error('');
    return 1;
  }

  const { ok, violations } = checkOwnership(paths, { staged });
  if (!ok) {
    reportViolations(violations);
    return 1;
  }
  console.log(
    `${green('✓')} граница цела ${dim(`(проверено файлов: ${paths.length})`)}`,
  );
  return 0;
}

function cmdHeat() {
  const { heat, path } = writeHeat({});
  console.log(
    `${green('✓')} карта горячих файлов пересчитана: ${heat.files.length} файлов с ${heat.threshold}+ касаниями за ${heat.windowDays} дней`,
  );
  console.log(dim(`  ${path} · upstream ${heat.upstreamHead}`));
  return 0;
}

function cmdDrift() {
  const ownership = loadOwnership();
  const registry = loadIntrusions();
  const wiring = ownership.budget.wiringFiles;
  const changed = changedSinceBase();

  const ours = changed.filter(
    (p) =>
      matches(p, 'aso/**') ||
      matches(p, 'scripts/aso/**') ||
      matches(p, '.qwen/**') ||
      matches(p, '.claude/**') ||
      matches(p, '.github/workflows/aso-*'),
  );
  const wiringTouched = changed.filter((p) => wiring.includes(p));
  const base = mergeBase();
  // Файл, которого нет у upstream, — наш собственный: конфликтовать нечему,
  // вторжением он не является, где бы ни лежал.
  const ownNewFiles = changed.filter(
    (p) =>
      !ours.includes(p) && !wiringTouched.includes(p) && !existsAtBase(p, base),
  );
  const functional = changed.filter(
    (p) =>
      !ours.includes(p) &&
      !wiringTouched.includes(p) &&
      !ownNewFiles.includes(p),
  );

  console.log(bold('Фактическая дельта форка против upstream'));
  console.log('');
  console.log(`  наше (свои каталоги):      ${ours.length} файлов`);
  console.log(`  наши новые файлы:          ${ownNewFiles.length}`);
  console.log(
    `  служебные швы:             ${wiringTouched.length} из ${wiring.length}`,
  );
  console.log(
    `  функциональные вторжения:  ${functional.length} при лимите ${ownership.budget.maxFunctionalIntrusions}`,
  );
  console.log('');

  let bad = 0;
  for (const p of functional) {
    const entry = registry.intrusions.find((i) => i.path === p);
    if (entry) {
      console.log(
        `  ${green('•')} ${p} ${dim(`— ${entry.id}, до ${entry.expires}`)}`,
      );
    } else {
      console.log(`  ${red('•')} ${p} ${red('— нет записи в реестре')}`);
      bad++;
    }
  }
  for (const entry of registry.intrusions) {
    if (!changed.includes(entry.path)) {
      console.log(
        `  ${yellow('•')} ${entry.id} ${entry.path} ${yellow('— запись есть, а отличия нет: удали её')}`,
      );
      bad++;
    }
  }
  if (functional.length > ownership.budget.maxFunctionalIntrusions) {
    console.log('');
    console.log(
      red(`  Бюджет вторжений превышен. Форк дрейфует из мягкого в жёсткий.`),
    );
    bad++;
  }
  if (!bad) {
    console.log('');
    console.log(`${green('✓')} реестр совпадает с реальностью`);
  }
  return bad ? 1 : 0;
}

function cmdBrief() {
  const ownership = loadOwnership();
  const heat = loadHeat();
  const registry = loadIntrusions();
  const branch = currentBranch();
  const base = gitSafe(['merge-base', 'upstream/main', 'HEAD']);
  const behind = base
    ? gitSafe(['rev-list', '--count', `${base}..upstream/main`], '?')
    : '?';
  const lastSync = base
    ? gitSafe(['log', '-1', '--format=%cr', base], '?')
    : '?';

  console.log('');
  console.log(
    bold('ФОРК aptyp78/qwen-code') +
      dim('  ·  мягкий форк QwenLM/qwen-code  ·  боевой инструмент'),
  );
  console.log('');
  console.log(bold('ГДЕ Я'));
  console.log(`  ветка        ${branch}`);
  console.log(
    `  upstream     отстаём на ${behind} коммитов, база от ${lastSync}`,
  );
  console.log(
    `  stable       ${gitSafe(['rev-parse', '--short', 'stable'], '—')}`,
  );
  console.log('');
  console.log(bold('ЧТО МОЖНО СВОБОДНО'));
  for (const z of ownership.zones.filter(
    (z) => z.policy === 'free' || z.policy === 'additive',
  )) {
    console.log(
      `  ${dim(z.policy.padEnd(9))} ${z.globs.slice(0, 4).join('  ')}${z.globs.length > 4 ? dim('  …') : ''}`,
    );
  }
  console.log('');
  console.log(bold('ЧТО НЕЛЬЗЯ БЕЗ РЕГИСТРАЦИИ'));
  console.log(
    `  ${heat.files.length} горячих файлов upstream (${heat.threshold}+ касаний за квартал), например:`,
  );
  for (const f of heat.files.slice(0, 5)) {
    console.log(`    ${String(f.touches).padStart(4)}  ${f.path}`);
  }
  console.log(dim('  → node scripts/aso/cli.js intrude <путь>'));
  console.log('');
  console.log(bold('ЧТО НЕЛЬЗЯ ВООБЩЕ'));
  console.log(
    '  править aso/ownership.json, aso/intrusions.json, scripts/aso/**, .husky/**',
  );
  console.log(
    '  коммитить в main и stable · git push --force · git commit --no-verify',
  );
  console.log('');
  console.log(bold('СОСТОЯНИЕ'));
  console.log(
    `  вторжений в upstream: ${registry.intrusions.length} при лимите ${ownership.budget.maxFunctionalIntrusions}`,
  );
  console.log('');
  console.log(dim('Перед «готово»:  node scripts/aso/cli.js check'));
  console.log('');
  return 0;
}

function cmdIntrude(args) {
  const path = args[0];
  if (!path) {
    console.error('Укажи путь: node scripts/aso/cli.js intrude <путь>');
    return 1;
  }
  const heat = loadHeat();
  const touches = heat.files.find((f) => f.path === path)?.touches ?? 0;

  console.log('');
  console.log(bold(`Регистрация вторжения: ${path}`));
  console.log('');
  console.log(
    `Частота правок в upstream: ${touches} за ${heat.windowDays} дней.`,
  );
  console.log('');
  console.log(LADDER);
  console.log('');
  console.log(
    'Реестр правит только владелец. Агент не может выдать себе разрешение —\nв этом весь смысл. Покажи владельцу фрагмент ниже и объясни словами,\nпочему каждая ступень лестницы не подошла.',
  );
  console.log('');
  const stamp = gitSafe(['log', '-1', '--format=%cs'], '2026-01-01');
  console.log(
    JSON.stringify(
      {
        id: 'FI-XXXX',
        path,
        anchor: 'смысловое-имя',
        reason: 'ЗАПОЛНИТЬ: зачем это нужно',
        alternativesRejected: [
          'T1 расширение: ЗАПОЛНИТЬ почему не подошло',
          'T2 свой пакет: ЗАПОЛНИТЬ почему не подошло',
        ],
        strategy: 'hook-point',
        maxLines: 20,
        approvedBy: 'owner',
        approvedAt: stamp,
        expires: 'ЗАПОЛНИТЬ: +3 месяца',
        upstreamable: false,
      },
      null,
      2,
    ),
  );
  console.log('');
  return 0;
}

/**
 * Проверка здоровья форка. Отвечает на вопрос «всё ли цело» — включая то,
 * что ломается молча: умерший хук, вернувшееся автообновление, сборку под
 * Node 20.
 */
function cmdDoctor() {
  const home = homedir();
  const problems = [];
  const line = (okFlag, text, hint) => {
    console.log(`  ${okFlag ? green('✓') : red('✗')} ${text}`);
    if (!okFlag && hint) {
      console.log(`      ${dim(hint)}`);
      problems.push(text);
    }
  };

  console.log('');
  console.log(bold('Здоровье форка'));
  console.log('');

  // Автообновление: включённое молча заменит нашу сборку версией Qwen.
  let autoUpdate = null;
  try {
    const s = JSON.parse(
      readFileSync(join(home, '.qwen', 'settings.json'), 'utf8'),
    );
    autoUpdate = s.general?.enableAutoUpdate;
  } catch {
    /* конфига может не быть */
  }
  line(
    autoUpdate === false,
    `автообновление продукта: ${autoUpdate === false ? 'выключено' : String(autoUpdate)}`,
    'включи выключение: general.enableAutoUpdate = false в ~/.qwen/settings.json',
  );

  // Каналы поставки.
  const stable = join(home, '.qwen-aso', 'channels', 'stable');
  let stableVersion = null;
  try {
    stableVersion = JSON.parse(
      readFileSync(join(stable, 'release.json'), 'utf8'),
    ).version;
  } catch {
    /* канал пуст */
  }
  line(
    Boolean(stableVersion),
    `канал stable: ${stableVersion ?? 'пуст'}`,
    'собери и промоутни: node scripts/aso/release.js build && promote',
  );

  // Node в обёртке. Активная версия nvm на этой машине — 20.
  const nodeLink = join(home, '.qwen-aso', 'node');
  const nodeOk = existsSync(nodeLink);
  line(
    nodeOk,
    `Node для обёрток: ${nodeOk ? 'прибит абсолютным путём' : 'не прибит'}`,
    'node scripts/aso/release.js wrappers',
  );

  // Хуки: молчание отличается от отказа только по журналу.
  const hookLog = join(REPO_ROOT_LOCAL, 'aso', '.cache', 'hook.log');
  const hookFresh =
    existsSync(hookLog) &&
    Date.now() - statSync(hookLog).mtimeMs < 30 * 24 * 3600 * 1000;
  line(
    hookFresh,
    `хуки в сессиях: ${hookFresh ? 'вызывались за последний месяц' : 'следов вызова нет'}`,
    'upstream может включить TrustedHooksManager — тогда хуки умрут молча',
  );

  // Граница.
  const ownership = loadOwnership();
  const registry = loadIntrusions();
  line(
    registry.intrusions.length <= ownership.budget.maxFunctionalIntrusions,
    `вторжений в upstream: ${registry.intrusions.length} при лимите ${ownership.budget.maxFunctionalIntrusions}`,
    'форк дрейфует из мягкого в жёсткий',
  );

  // Отставание.
  const base = gitSafe(['merge-base', 'upstream/main', 'HEAD']);
  const behind = base
    ? Number(gitSafe(['rev-list', '--count', `${base}..upstream/main`], '0'))
    : 0;
  line(
    behind < 2000,
    `отставание от upstream: ${behind} коммитов`,
    'пора синхронизироваться: скилл /aso-sync',
  );

  console.log('');
  console.log(
    problems.length
      ? red(`  Требует внимания: ${problems.length}`)
      : green('  Всё цело'),
  );
  console.log('');
  return problems.length ? 1 : 0;
}

/**
 * Цель следующего слияния.
 *
 * Исходно правило звучало «синхронизироваться на релизный тег». Проверка на
 * месте показала, что у upstream теги релизов лежат на отдельных ветках
 * `release/vX.Y.Z` и недостижимы из `main`, — форк, идущий за главной веткой,
 * слиться на них не может. Замысел выдержки при этом остаётся верным: берём
 * самый свежий коммит главной ветки, которому уже есть N дней, чтобы Qwen
 * успел выкатить свои же исправления.
 */
function cmdTarget(args) {
  const soakArg = args.find((a) => a.startsWith('--soak-days='));
  const soakDays = soakArg ? Number(soakArg.split('=')[1]) : 5;
  const ref = 'upstream/main';
  const base = gitSafe(['merge-base', ref, 'HEAD']);

  const cutoff = new Date(Date.now() - soakDays * 24 * 3600 * 1000);
  const sha = gitSafe([
    'rev-list',
    '-1',
    `--before=${cutoff.toISOString()}`,
    ref,
  ]);

  const ahead = base
    ? Number(gitSafe(['rev-list', '--count', `${base}..${ref}`], '0'))
    : 0;

  console.log('');
  console.log(bold('Цель следующего слияния'));
  console.log('');
  console.log(`  выдержка          ${soakDays} дней`);
  console.log(
    `  наша база         ${gitSafe(['log', '-1', '--format=%h %cs', base])}`,
  );
  console.log(
    `  upstream/main     ${gitSafe(['log', '-1', '--format=%h %cs', ref])}`,
  );
  console.log(`  доступно новых    ${ahead} коммитов`);
  console.log('');

  if (
    !sha ||
    (base && gitSafe(['merge-base', '--is-ancestor', sha, base], 'x') === '')
  ) {
    const isOld = base
      ? (() => {
          try {
            git(['merge-base', '--is-ancestor', sha, base], { quiet: true });
            return true;
          } catch {
            return false;
          }
        })()
      : false;
    if (!sha || isOld) {
      console.log(
        `  ${yellow('•')} Нечего сливать: всё, что старше ${soakDays} дней, у нас уже есть.`,
      );
      console.log(
        dim(
          '    Это нормально сразу после форка — подожди, пока новые коммиты отлежатся.',
        ),
      );
      console.log('');
      return 0;
    }
  }

  console.log(
    `  ${green('→')} цель: ${gitSafe(['log', '-1', '--format=%h %cs %s', sha])}`,
  );
  console.log('');
  console.log(
    dim('    git switch -c sync/$(date +%Y%m%d) dev && git merge ' + sha),
  );
  console.log('');
  return 0;
}

const [, , command = 'brief', ...rest] = process.argv;
const commands = {
  brief: cmdBrief,
  check: cmdCheck,
  heat: cmdHeat,
  drift: cmdDrift,
  intrude: cmdIntrude,
  doctor: cmdDoctor,
  target: cmdTarget,
};

const handler = commands[command];
if (!handler) {
  console.error(`Неизвестная команда: ${command}`);
  console.error(`Доступны: ${Object.keys(commands).join(', ')}`);
  process.exit(2);
}
process.exit(handler(rest));

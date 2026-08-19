/**
 * @license
 * Copyright 2026 Arthur Ocheretny
 * SPDX-License-Identifier: Apache-2.0
 *
 * Пересчитывает карту «горячих» файлов upstream из его же истории.
 * Список никогда не пишется руками: через три месяца рукописный список врёт,
 * а решение о цене вторжения принимается именно по нему.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASO_DIR, git, gitSafe } from './lib.js';

const DEFAULT_DAYS = 90;
const DEFAULT_THRESHOLD = 40;

export function computeHeat({
  days = DEFAULT_DAYS,
  threshold = DEFAULT_THRESHOLD,
  ref = 'upstream/main',
} = {}) {
  const raw = git([
    'log',
    `--since=${days}.days`,
    ref,
    '--name-only',
    '--pretty=format:',
  ]);

  const counts = new Map();
  for (const line of raw.split('\n')) {
    const file = line.trim();
    if (!file) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }

  const files = [...counts.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([path, touches]) => ({ path, touches }));

  return {
    generatedFrom: ref,
    generatedAt: gitSafe(['log', '-1', '--format=%cI', ref]),
    upstreamHead: gitSafe(['rev-parse', '--short', ref]),
    windowDays: days,
    threshold,
    totalTouchedFiles: counts.size,
    files,
  };
}

export function writeHeat(options) {
  const heat = computeHeat(options);
  const path = join(ASO_DIR, 'heat.json');
  writeFileSync(path, JSON.stringify(heat, null, 2) + '\n');
  return { heat, path };
}

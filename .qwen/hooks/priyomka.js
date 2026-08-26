#!/usr/bin/env node
// Приёмка продукта. Машина считает успехом сам факт молчания модели;
// этот хук заменяет молчание сдачей работы: пока обязанность не выполнена,
// причина возвращается агенту как новое задание, и он работает дальше.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const выполнено = /НЕРАЗЛИЧЕНО/.test(JSON.stringify(input));
  require('fs').appendFileSync(
    `${__dirname}/priyomka.log`,
    `${new Date().toISOString()}\tпопытка\tвыполнено=${выполнено}\n`,
  );
  if (выполнено) process.exit(0);
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        'Приёмка не пройдена: работа не сдана. В ответе нет обязательной строки ' +
        '`НЕРАЗЛИЧЕНО: <что осталось невыясненным>`. Предъяви ответ заново, ' +
        'добавив эту строку последней.',
    }),
  );
  process.exit(0);
});

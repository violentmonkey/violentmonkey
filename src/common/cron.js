const FIELD_RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const SEARCH_DAYS = 366 * 9;

export const DEFAULT_UPDATE_CRON = '0 12 * * *';

export function parseCron(expression) {
  if (typeof expression !== 'string') throw new Error('Invalid cron expression');
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== FIELD_RANGES.length) throw new Error('Invalid cron expression');
  const parsed = fields.map((field, index) => parseField(field, ...FIELD_RANGES[index], index));
  return {
    minute: parsed[0].values,
    hour: parsed[1].values,
    dom: parsed[2].values,
    month: parsed[3].values,
    dow: parsed[4].values,
    domAny: fields[2] === '*',
    dowAny: fields[4] === '*',
  };
}

export function isValidCron(expression) {
  try {
    parseCron(expression);
    return getNextCronTime(expression) != null;
  } catch {
    return false;
  }
}

export function normalizeCron(expression) {
  if (typeof expression !== 'string') throw new Error('Invalid cron expression');
  const value = expression.trim().replace(/\s+/g, ' ');
  if (!isValidCron(value)) throw new Error('Invalid cron expression');
  return value;
}

export function migrateAutoUpdate(value) {
  const text = String(value ?? '').trim();
  const number = Number(value ?? 0);
  if (number === 0) return '';
  if (Number.isFinite(number)) {
    const step = Math.max(1, Math.min(16, Math.floor(number)));
    return step === 1 ? DEFAULT_UPDATE_CRON : `0 12 */${step} * *`;
  }
  try {
    return normalizeCron(text);
  } catch {
    return DEFAULT_UPDATE_CRON;
  }
}

export function normalizeUpdateCron(value) {
  if (value == null || value === false || value === '') return '';
  if (typeof value !== 'string') throw new Error('Invalid cron expression');
  return normalizeCron(value);
}

export function getCronOccurrence(expression, timestamp, tolerance = 0) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return;
  date.setSeconds(0, 0);
  const candidates = [
    getNextCronTime(expression, date.getTime() - 1, true),
    getNextCronTime(expression, date.getTime() - 60e3 - 1),
  ].filter(value => value != null && value <= timestamp);
  const occurrence = candidates.sort((a, b) => b - a)[0];
  return occurrence != null && timestamp - occurrence <= tolerance ? occurrence : undefined;
}

export function isCronOccurrence(expression, timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return false;
  date.setSeconds(0, 0);
  return getCronOccurrence(expression, timestamp) === date.getTime();
}

export function getNextCronTime(expression, from = Date.now(), inclusive = false) {
  const parsed = parseCron(expression);
  const timestamp = +from;
  if (!Number.isFinite(timestamp)) return;
  const start = new Date(timestamp);
  if (!Number.isFinite(start.getTime())) return;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const startMinute = start.getHours() * 60 + start.getMinutes()
    + (inclusive && !start.getSeconds() && !start.getMilliseconds() ? 0 : 1);
  const dayLimit = new Date(startDay);
  dayLimit.setDate(startDay.getDate() + SEARCH_DAYS);
  for (let dayIndex = 0, day = new Date(startDay); day < dayLimit; day.setDate(day.getDate() + 1), dayIndex += 1) {
    if (!matchesDate(day, parsed)) continue;
    const firstMinute = dayIndex ? 0 : startMinute;
    for (const hour of parsed.hour) {
      for (const minute of parsed.minute) {
        const time = hour * 60 + minute;
        if (time < firstMinute) continue;
        const result = new Date(day);
        result.setHours(hour, minute, 0, 0);
        if (result.getHours() !== hour || result.getMinutes() !== minute) continue;
        if (result.getTime() > timestamp || inclusive && result.getTime() === timestamp) {
          return result.getTime();
        }
      }
    }
  }
}

function parseField(field, min, max, index) {
  if (!field) throw new Error('Invalid cron expression');
  const values = new Set();
  let wildcard = false;
  for (const part of field.split(',')) {
    const pieces = part.split('/');
    if (pieces.length > 2) throw new Error('Invalid cron expression');
    const [range, stepText] = pieces;
    if (stepText != null && !/^\d+$/.test(stepText)) throw new Error('Invalid cron expression');
    const step = stepText == null ? 1 : +stepText;
    if (step < 1) throw new Error('Invalid cron expression');
    let start;
    let end;
    if (range === '*') {
      start = min;
      end = max;
      wildcard ||= stepText == null;
    } else {
      const rangePieces = range.split('-');
      if (rangePieces.length > 2 || !rangePieces[0]) throw new Error('Invalid cron expression');
      start = parseValue(rangePieces[0], min, max);
      end = rangePieces.length === 2
        ? parseValue(rangePieces[1], min, max)
        : start;
      if (start > end) throw new Error('Invalid cron expression');
    }
    for (let value = start; value <= end; value += step) {
      values.add(index === 4 && value === 7 ? 0 : value);
    }
  }
  return {
    values: new Set([...values].sort((a, b) => a - b)),
    wildcard,
  };
}

function parseValue(value, min, max) {
  if (!/^\d+$/.test(value)) throw new Error('Invalid cron expression');
  const number = +value;
  if (number < min || number > max) throw new Error('Invalid cron expression');
  return number;
}

function matchesDate(date, parsed) {
  if (!parsed.month.has(date.getMonth() + 1)) return false;
  const domMatch = parsed.dom.has(date.getDate());
  const dowMatch = parsed.dow.has(date.getDay());
  if (parsed.domAny) return dowMatch;
  if (parsed.dowAny) return domMatch;
  return domMatch || dowMatch;
}

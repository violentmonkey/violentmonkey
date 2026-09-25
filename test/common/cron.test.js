import {
  DEFAULT_UPDATE_CRON,
  getCronOccurrence,
  getNextCronTime,
  isCronOccurrence,
  isValidCron,
  migrateAutoUpdate,
  normalizeUpdateCron,
} from '@/common/cron';

const localTime = (year, month, day, hour, minute) => new Date(year, month - 1, day, hour, minute).getTime();
const localTimeWithSeconds = (year, month, day, hour, minute, second) => (
  new Date(year, month - 1, day, hour, minute, second).getTime()
);

test('validates five-field cron expressions', () => {
  expect(isValidCron('0 12 * * *')).toBe(true);
  expect(isValidCron('0 12 */2 * *')).toBe(true);
  expect(isValidCron('0 9-17/2 * * 1-5')).toBe(true);
  expect(isValidCron('0 0 1 1 *')).toBe(true);
  expect(isValidCron('0 0 31 2 *')).toBe(false);
  expect(isValidCron('0 12 * *')).toBe(false);
  expect(isValidCron('0 12 */0 * *')).toBe(false);
  expect(isValidCron('0 12 32 * *')).toBe(false);
});

test('finds the next cron occurrence', () => {
  const from = localTime(2026, 1, 1, 11, 0);
  expect(getNextCronTime('0 12 * * *', from)).toBe(localTime(2026, 1, 1, 12, 0));
  expect(getNextCronTime('0 12 */2 * *', from)).toBe(localTime(2026, 1, 1, 12, 0));
  expect(getNextCronTime('0 12 */2 * *', localTime(2026, 1, 1, 12, 0))).toBe(localTime(2026, 1, 3, 12, 0));
  expect(getNextCronTime('0 12 2 * *', from)).toBe(localTime(2026, 1, 2, 12, 0));
  expect(getNextCronTime('0 12,9 * * *', localTime(2026, 1, 1, 12, 0))).toBe(localTime(2026, 1, 2, 9, 0));
  const due = localTime(2026, 1, 1, 12, 0);
  expect(getNextCronTime('0 12 * * *', due, true)).toBe(due);
  expect(getNextCronTime('0 12 * * *', due)).toBe(localTime(2026, 1, 2, 12, 0));
  expect(isCronOccurrence('0 12 * * *', due)).toBe(true);
  expect(isCronOccurrence('0 13 * * *', due)).toBe(false);
  expect(getCronOccurrence('0 12 * * *', localTimeWithSeconds(2026, 1, 1, 12, 1, 10), 80e3))
    .toBe(due);
  expect(getNextCronTime('0 0 29 2 *', localTime(2026, 3, 1, 0, 0))).toBe(localTime(2028, 2, 29, 0, 0));
});

test('migrates legacy update intervals and normalizes canonical cron', () => {
  expect(migrateAutoUpdate(0)).toBe('');
  expect(migrateAutoUpdate(1)).toBe(DEFAULT_UPDATE_CRON);
  expect(migrateAutoUpdate(2)).toBe('0 12 */2 * *');
  expect(migrateAutoUpdate(365)).toBe('0 12 */16 * *');
  expect(migrateAutoUpdate(0.5)).toBe(DEFAULT_UPDATE_CRON);
  expect(migrateAutoUpdate(' 0 ')).toBe('');
  expect(migrateAutoUpdate('0 12 * * *')).toBe(DEFAULT_UPDATE_CRON);
  expect(migrateAutoUpdate('not a cron expression')).toBe(DEFAULT_UPDATE_CRON);
  expect(normalizeUpdateCron(' 0 12 * * * ')).toBe(DEFAULT_UPDATE_CRON);
  expect(() => normalizeUpdateCron(2)).toThrow();
  expect(() => normalizeUpdateCron('not a cron expression')).toThrow();
});

import { DATE_FMT, formatDate } from '@/common/date';

/** A local date whose timezone offset is `offset` minutes, as returned by getTimezoneOffset */
const dateWithOffset = (offset, ...args) => {
  const date = new Date(...args);
  date.getTimezoneOffset = () => offset;
  return date;
};

test('ZZ is the offset from UTC', () => {
  expect(DATE_FMT.ZZ(dateWithOffset(-180, 2026, 9, 24))).toBe('+0300'); // Istanbul
  expect(DATE_FMT.ZZ(dateWithOffset(420, 2026, 6, 1))).toBe('-0700'); // Los Angeles in summer
  expect(DATE_FMT.ZZ(dateWithOffset(-330, 2026, 0, 1))).toBe('+0530'); // India
  expect(DATE_FMT.ZZ(dateWithOffset(0, 2026, 0, 1))).toBe('+0000');
});

test('day and week of year count calendar days', () => {
  const date = new Date(2026, 2, 31, 0, 30);
  expect(DATE_FMT.DDD(date)).toBe(90);
  expect(formatDate('DDDD', date)).toBe('090');
  expect(DATE_FMT.DDD(new Date(2026, 11, 31, 23, 59))).toBe(365);
  expect(DATE_FMT.w(new Date(2026, 0, 7, 23, 59))).toBe(1);
  expect(DATE_FMT.w(new Date(2026, 0, 8, 0, 0))).toBe(2);
  // After DST starts, 00:30 local is less than a whole number of days after Jan 1 00:00,
  // e.g. in Berlin 2026-03-31 00:30 is 88 days and 23.5 hours later
  const afterDst = new Date(date - 3600e3);
  afterDst.getFullYear = () => 2026;
  afterDst.getMonth = () => 2;
  afterDst.getDate = () => 31;
  expect(DATE_FMT.DDD(afterDst)).toBe(90);
});

const DAY_MS = 24 * 3600e3;
const WEEK_MS = 7 * 24 * 3600e3;
// Using simple padding functions because String#padStart is Chrome57+ but our minimum is 55
const pad2 = num => `${num < 10 ? '0' : ''}${num}`;
const pad3 = num => `${num < 10 && '00' || num < 100 && '0' || ''}${num}`;
const getYear = date => date.getFullYear();
const getDayOfYear = date => Math.floor((date - new Date(getYear(date), 0, 1)) / DAY_MS) + 1;
const getWeekOfYear = date => Math.floor((date - new Date(getYear(date), 0, 1)) / WEEK_MS) + 1;
const toLocaleString = (date, opts) => date.toLocaleString([navigator.language], opts);

/** @type {Object<string,(Date)=>string>} */
export const DATE_FMT = {
  M: date => date.getMonth() + 1, // 1 2 ... 11 12
  MM: date => pad2(date.getMonth() + 1), // 01 02 ... 11 12
  MMM: date => toLocaleString(date, { month: 'short' }), // Jan Feb
  MMMM: date => toLocaleString(date, { month: 'long' }), // January February
  Q: date => Math.floor(date.getMonth() / 3) + 1, // 1 2 3 4
  D: date => date.getDate(), // 1 2 ... 30 31
  DD: date => pad2(date.getDate()), // 01 02 ... 30 31
  DDD: getDayOfYear, // 1 2 ... 364 365
  DDDD: date => pad3(getDayOfYear(date)), // 001 002 ... 364 365
  d: date => date.getDay(), // 0 1 ... 5 6
  dd: date => toLocaleString(date, { weekday: 'short' }).slice(0, 2), // Su Mo ... Fr Sa
  ddd: date => toLocaleString(date, { weekday: 'short' }), // Sun Mon ... Fri Sat
  dddd: date => toLocaleString(date, { weekday: 'long' }), // Sunday Monday ... Friday Saturday
  w: getWeekOfYear, // 1 2 ... 52 53
  ww: date => pad2(getWeekOfYear(date)), // 01 02 ... 52 53
  Y: getYear,
  YY: date => pad2(getYear(date) % 100),
  YYYY: date => `${getYear(date)}`.slice(-4),
  H: date => date.getHours(), // 0 1 ... 22 23
  HH: date => pad2(date.getHours()), // 00 01 ... 22 23
  m: date => date.getMinutes(), // 0 1 ... 58 59
  mm: date => pad2(date.getMinutes()), // 00 01 ... 58 59
  s: date => date.getSeconds(), // 0 1 ... 58 59
  ss: date => pad2(date.getSeconds()), // 00 01 ... 58 59
  S: date => `${+date}`.slice(-3, -2), // fractional second 0 1 ... 8 9
  SS: date => `${+date}`.slice(-3, -1), // fractional second 00 01 ... 98 99
  SSS: date => `${+date}`.slice(-3), // fractional second 000 001 ... 998 999
  ZZ: date => { // -0700 -0600 ... +0600 +0700
    const tz = date.getTimezoneOffset();
    const tza = Math.abs(tz);
    return `${tz < 0 ? '-' : '+'}${pad2(Math.floor(tza / 60))}${pad2(Math.floor(tza % 60))}`;
  },
};

let re;

export function formatDate(tpl, date = new Date()) {
  if (!re) {
    re = new RegExp(`${
      // moment.js escaping for [literal text]
      /\[([^[\]]*)]/.source
    }|${
      // Matching longest first to allow omitting separators e.g. HHMM
      Object.keys(DATE_FMT).sort((a, b) => b.length - a.length).join('|')
    }`, 'g');
  }
  return tpl.replace(re, (s, literal) => (
    hasOwnProperty(DATE_FMT, s)
      ? DATE_FMT[s](date)
      : literal ?? s
  ));
}

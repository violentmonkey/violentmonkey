import options from '@/common/options';
import hookSetting from '@/common/hook-setting';
import { debounce } from '@/common';

export const NORMALIZE = Symbol();

/** @this {object} enum */
export function normalizeEnum(val) {
  return hasOwnProperty(this, val) ? val : Object.keys(this)[0];
}

/**
 * @param {object} items - source definitions
 * @param {object} settings - target
 * @param {function} watch - Vue's watch()
 * @param {number} [delay] - debounce
 * @return {any[]}
 */
export function hookSettingsForUI(items, settings, watch, delay) {
  const revokers = [];
  for (const key in items) {
    const obj = items[key];
    const normalize = isFunction(obj) ? obj
      : obj[NORMALIZE] || normalizeEnum.bind(obj);
    const updater = (val, old) => {
      val = normalize(val, key);
      old = normalize(old, key);
      if (val !== old) options.set(key, val);
    };
    revokers.push(
      hookSetting(key, val => {
        settings[key] = normalize(val, key);
      }),
      watch(() => settings[key],
        delay ? debounce(updater, delay) : updater),
    );
  }
  return revokers;
}

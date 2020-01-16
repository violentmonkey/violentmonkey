import options from './options';
import { forEachEntry, objectGet } from './object';

const hooks = {};

options.hook((data) => {
  hooks::forEachEntry(([key, list]) => {
    if (list) {
      const value = objectGet(data, key);
      if (value !== undefined) list.forEach(update => update(value));
    }
  });
});

/**
 * When an option is updated elsewhere (or when a yet unresolved options.ready will be fired),
 * calls the specified `update` function or assigns the specified `prop` in `target` object.
 * Also, when the latter mode is used, option.get() is called explicitly right away,
 * but only if options.ready is resolved or `transform` function is specified.
 * @param {string} key - option name
 * @param {function(value) | { target, prop, transform }} update - either a function or the config object
 * @return {function}
 */
export default function hookSetting(key, update) {
  const { target } = update;
  if (target) {
    const { prop, transform } = update;
    update = value => { target[prop] = transform ? transform(value) : value; };
    if (transform || options.ready.indeed) update(options.get(key));
  }
  const list = hooks[key] || (hooks[key] = []);
  list.push(update);
  return () => {
    const i = list.indexOf(update);
    if (i >= 0) list.splice(i, 1);
  };
}

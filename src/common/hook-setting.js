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
 option.get() is called even if it's not ready (a null or default value will be used),
 which shouldn't happen usually as we retrieve the options in browser.js the first thing,
 so either do `await options.ready` beforehand or handle the empty/default value inside update()
*/
export default function hookSetting(key, update) {
  update(options.get(key));
  const list = hooks[key] || (hooks[key] = []);
  list.push(update);
  return () => {
    const i = list.indexOf(update);
    if (i >= 0) list.splice(i, 1);
  };
}

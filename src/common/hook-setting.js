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

export default function hookSetting(key, update) {
  options.ready.then(() => update(options.get(key)));
  const list = hooks[key] || (hooks[key] = []);
  list.push(update);
  return () => {
    const i = list.indexOf(update);
    if (i >= 0) list.splice(i, 1);
  };
}

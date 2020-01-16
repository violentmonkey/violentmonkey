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

export default function hook(key, update) {
  let list = hooks[key];
  if (!list) {
    list = [];
    hooks[key] = list;
  }
  list.push(update);
  return () => {
    const i = list.indexOf(update);
    if (i >= 0) list.splice(i, 1);
  };
}

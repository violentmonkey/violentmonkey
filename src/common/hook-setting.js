import options from './options';

const hooks = {};

options.hook(data => {
  Object.keys(data).forEach(key => {
    const list = hooks[key];
    if (list) list.forEach(update => { update(data[key]); });
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

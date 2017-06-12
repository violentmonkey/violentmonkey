import options from 'src/common/options';

const hooks = {};

options.hook(data => {
  Object.keys(data).forEach(key => {
    const list = hooks[key];
    if (list) list.forEach(update => { update(data[key]); });
  });
});

export default function hook(key, item) {
  let list = hooks[key];
  if (!list) {
    list = [];
    hooks[key] = list;
  }
  list.push(item);
  return () => {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  };
}

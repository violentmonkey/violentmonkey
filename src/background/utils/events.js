export default function getEventEmitter() {
  const events = {};
  return { on, off, fire };

  function on(type, func) {
    let list = events[type];
    if (!list) {
      list = [];
      events[type] = list;
    }
    list.push(func);
  }
  function off(type, func) {
    const list = events[type];
    if (list) {
      const i = list.indexOf(func);
      if (i >= 0) list.splice(i, 1);
    }
  }
  function fire(type, data) {
    const list = events[type];
    if (list) {
      list.forEach(func => {
        func(data, type);
      });
    }
  }
}

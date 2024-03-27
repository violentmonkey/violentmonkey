import options from './options';

const handlers = {
  __proto__: null,
  Reload(delay) {
    setTimeout(() => location.reload(), delay);
  },
  UpdateOptions(data) {
    options.update(data);
  },
};

browser.runtime.onMessage.addListener((res, src) => {
  const handle = handlers[res.cmd];
  if (handle) {
    src.url = res.url || src.url; // MessageSender.url doesn't change on soft navigation
    return handle(res.data, src);
  }
});

export default handlers;

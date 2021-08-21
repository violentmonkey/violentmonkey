import options from './options';

const handlers = {
  UpdateOptions(data) {
    options.update(data);
  },
};

browser.runtime.onMessage.addListener((res, src) => {
  const handle = handlers[res.cmd];
  if (handle) handle(res.data, src);
});

export default handlers;

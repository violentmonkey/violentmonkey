import { showUnhandledError } from '@/common/ui';
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
    res = handle(res.data, src);
    res?.catch?.(showUnhandledError);
    return res;
  }
});

export default handlers;

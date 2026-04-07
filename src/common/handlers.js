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
    let safeSrc = src;
    if (src && handle.length > 1) {
      try {
        safeSrc = {
          tab: src.tab && { ...src.tab },
          url: res.url || src.url,
          [kFrameId]: src[kFrameId],
          [kDocumentId]: src[kDocumentId],
          [kTop]: src[kTop],
        };
      } catch {
        safeSrc = { url: res.url };
      }
    }
    res = handle(res.data, safeSrc);
    res?.catch?.(showUnhandledError);
    return res;
  }
});

export default handlers;

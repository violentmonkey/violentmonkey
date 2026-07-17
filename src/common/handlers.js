import browser from './browser';

const handlers = {
  __proto__: null,
};

const handleMessage = (res, src) => {
  const handle = handlers[res.cmd];
  if (handle) {
    src.url = res.url || src.url; // MessageSender.url doesn't change on soft navigation
    res = handle(res.data, src);
    res?.catch?.(global.onerror);
    return res;
  }
};

if (__.EXT && (__.MV3 ? !__.SW : !global._bg)) {
  browser.runtime.onMessage.addListener(handleMessage);
  if (__.MV3) chrome.runtime.onUserScriptMessage?.addListener(handleMessage);
}

export default handlers;

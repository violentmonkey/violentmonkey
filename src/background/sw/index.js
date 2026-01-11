import '@/common/browser';
import { addPublicCommands, commands } from '../utils/init';

const { browser, chrome } = globalThis;
let offscreenReady;
let requestIdCounter = 0;
const offscreenUrl = chrome?.runtime?.getURL('offscreen/index.html');
const SMOKE_SCRIPT_ID = 'vm3-smoke';
const RPC_TYPE = 'VM3_RPC';
const SMOKE_RESULT_TYPE = 'VM3_SMOKE_RESULT';
const STORAGE_PREFIX = 'vm3:';

console.info('VM MV3 SW: started');

async function isUserScriptsAvailable() {
  if (!chrome?.userScripts?.getScripts) return false;
  try {
    await chrome.userScripts.getScripts();
    return true;
  } catch (error) {
    return false;
  }
}

async function configureUserScripts() {
  if (!await isUserScriptsAvailable()) return;
  try {
    await chrome.userScripts.configureWorld({ messaging: true });
  } catch (error) {
    console.warn('VM MV3 SW: configureWorld failed', error);
  }
}

async function hasSmokeScript() {
  if (!chrome?.userScripts?.getScripts) return false;
  try {
    const scripts = await chrome.userScripts.getScripts({ ids: [SMOKE_SCRIPT_ID] });
    return scripts?.length > 0;
  } catch (error) {
    return false;
  }
}

async function registerSmokeScript() {
  if (!await isUserScriptsAvailable()) return;
  try {
    await chrome.userScripts.register([{
      id: SMOKE_SCRIPT_ID,
      matches: ['https://example.com/*'],
      runAt: 'document_start',
      world: 'USER_SCRIPT',
      js: [{
        code: `
          (async () => {
            const send = chrome.runtime.sendMessage;
            const makeId = () => String(Date.now()) + Math.random().toString(36).slice(2);
            const rpc = (method, params) => new Promise((resolve, reject) => {
              const requestId = makeId();
              send({ type: '${RPC_TYPE}', requestId, method, params, script: { id: '${SMOKE_SCRIPT_ID}', name: 'VM3 Smoke' } }, res => {
                if (!res) return reject(new Error('No response'));
                if (res.ok) return resolve(res.result);
                reject(new Error(res.error || 'RPC error'));
              });
            });
            send({ type: 'VM3_SMOKE_RAN', url: location.href });
            const valueKey = 'vm3-smoke';
            await rpc('GM_setValue', { key: valueKey, value: 'ok' });
            const roundTrip = await rpc('GM_getValue', { key: valueKey, defaultValue: 'missing' });
            const xhr = await rpc('GM_xmlhttpRequest', { method: 'GET', url: 'https://example.com', responseType: 'text' });
            send({
              type: '${SMOKE_RESULT_TYPE}',
              url: location.href,
              ok: roundTrip === 'ok',
              storedValue: roundTrip,
              xhrStatus: xhr?.status,
            });
          })();
        `,
      }],
    }]);
  } catch (error) {
    console.warn('VM MV3 SW: register smoke failed', error);
  }
}

function logSmokeMessage(payload) {
  if (payload?.type === 'VM3_SMOKE_RAN') {
    console.info(`VM MV3 SMOKE: ran ${payload.url}`);
  }
  if (payload?.type === SMOKE_RESULT_TYPE) {
    console.info('VM MV3 SMOKE: result', payload);
  }
}

function getScriptNamespace(script) {
  return script?.id || script?.name || 'unknown';
}

function getValueKey(script, key) {
  return `${STORAGE_PREFIX}${getScriptNamespace(script)}:${key}`;
}

async function gmGetValue({ key, defaultValue }, script) {
  if (!key) return defaultValue;
  const storageKey = getValueKey(script, key);
  const result = await chrome.storage.local.get(storageKey);
  if (!(storageKey in result)) return defaultValue;
  try {
    return JSON.parse(result[storageKey]);
  } catch (error) {
    return defaultValue;
  }
}

async function gmSetValue({ key, value }, script) {
  if (!key) return false;
  const storageKey = getValueKey(script, key);
  await chrome.storage.local.set({ [storageKey]: JSON.stringify(value) });
  return true;
}

async function gmDeleteValue({ key }, script) {
  if (!key) return false;
  const storageKey = getValueKey(script, key);
  await chrome.storage.local.remove(storageKey);
  return true;
}

async function gmListValues(_params, script) {
  const prefix = `${STORAGE_PREFIX}${getScriptNamespace(script)}:`;
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter(storageKey => storageKey.startsWith(prefix))
    .map(storageKey => storageKey.slice(prefix.length));
}

async function gmXmlHttpRequest(params) {
  const method = params?.method || 'GET';
  const controller = new AbortController();
  const timeoutMs = params?.timeout;
  const headers = new Headers(params?.headers || {});
  const options = {
    method,
    headers,
    signal: controller.signal,
  };
  if (params?.data != null && method !== 'GET' && method !== 'HEAD') {
    options.body = params.data;
  }
  let timeoutId;
  if (timeoutMs) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const response = await fetch(params?.url, options);
    const responseHeaders = [];
    response.headers.forEach((value, name) => {
      responseHeaders.push(`${name}: ${value}`);
    });
    let responseBody;
    if (params?.responseType === 'json') {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }
    return {
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      responseHeaders: responseHeaders.join('\r\n'),
      response: responseBody,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function handleRpcMessage(message) {
  const { method, params, script } = message;
  switch (method) {
    case 'GM_getValue':
      return gmGetValue(params, script);
    case 'GM_setValue':
      return gmSetValue(params, script);
    case 'GM_deleteValue':
      return gmDeleteValue(params, script);
    case 'GM_listValues':
      return gmListValues(params, script);
    case 'GM_xmlhttpRequest':
      return gmXmlHttpRequest(params);
    default:
      throw new Error(`Unknown RPC method: ${method}`);
  }
}

async function hasOffscreenDocument() {
  if (!chrome?.runtime || !offscreenUrl) return false;
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    return contexts?.some(context => context.documentUrl === offscreenUrl);
  }
  if (chrome.offscreen?.hasDocument) {
    return chrome.offscreen.hasDocument();
  }
  return false;
}

async function ensureOffscreenDocument() {
  if (!chrome?.offscreen || !offscreenUrl) {
    throw new Error('Offscreen API is not available.');
  }
  if (offscreenReady) return offscreenReady;
  offscreenReady = (async () => {
    const hasDocument = await hasOffscreenDocument();
    if (hasDocument) return;
    try {
      await chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: [
          chrome.offscreen.Reason.CLIPBOARD,
          chrome.offscreen.Reason.BLOBS,
        ],
        justification: 'Clipboard and image/blob processing for MV3 service worker.',
      });
    } catch (error) {
      if (!/already exists/i.test(`${error}`)) {
        throw error;
      }
    }
  })();
  try {
    await offscreenReady;
  } catch (error) {
    offscreenReady = null;
    throw error;
  }
}

async function callOffscreen(method, params) {
  await ensureOffscreenDocument();
  const requestId = `${Date.now()}-${++requestIdCounter}`;
  const timeoutMs = 5000;
  const message = { vm3Offscreen: true, method, params, requestId };
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Offscreen ${method} timed out.`)), timeoutMs);
  });
  const response = await Promise.race([
    browser.runtime.sendMessage(message),
    timeout,
  ]).finally(() => clearTimeout(timeoutId));
  if (!response || response.requestId !== requestId) {
    throw new Error(`Invalid offscreen response for ${method}.`);
  }
  if (!response.ok) {
    throw new Error(response.error || `Offscreen ${method} failed.`);
  }
  return response;
}

addPublicCommands({
  async SetClipboard({ text }) {
    try {
      return await callOffscreen('SetClipboard', { text });
    } catch (error) {
      console.warn('VM MV3 SW: SetClipboard failed', error);
      return { ok: false, error: `${error}` };
    }
  },
  async GetImageData({ url, includeData, maxInlineBytes }) {
    try {
      return await callOffscreen('GetImageData', { url, includeData, maxInlineBytes });
    } catch (error) {
      console.warn('VM MV3 SW: GetImageData failed', error);
      return { ok: false, error: `${error}` };
    }
  },
});

browser.runtime.onInstalled.addListener((details) => {
  console.info('VM MV3 SW: onInstalled');
  configureUserScripts();
  const shouldRegister = details?.reason === 'update';
  if (shouldRegister) {
    registerSmokeScript();
    return;
  }
  hasSmokeScript()
    .then(hasScript => {
      if (hasScript) return;
      return registerSmokeScript();
    })
    .catch(error => console.warn('VM MV3 SW: smoke check failed', error));
});

browser.runtime.onStartup.addListener(() => {
  console.info('VM MV3 SW: onStartup');
  configureUserScripts();
  hasSmokeScript()
    .then(hasScript => {
      if (hasScript) return;
      return registerSmokeScript();
    })
    .catch(error => console.warn('VM MV3 SW: smoke check failed', error));
});

const userScriptMessageHandler = (message, _sender, sendResponse) => {
  logSmokeMessage(message);
  if (message?.type !== RPC_TYPE) return undefined;
  (async () => {
    try {
      const result = await handleRpcMessage(message);
      sendResponse({ ok: true, result });
    } catch (error) {
      sendResponse({ ok: false, error: `${error}` });
    }
  })();
  return true;
};

if (chrome?.runtime?.onUserScriptMessage?.addListener) {
  chrome.runtime.onUserScriptMessage.addListener(userScriptMessageHandler);
} else {
  browser.runtime.onMessage.addListener(userScriptMessageHandler);
}

browser.runtime.onMessage.addListener((message, sender) => {
  const { cmd, data } = message || {};
  const handler = commands[cmd];
  if (!handler) return undefined;
  return handler(data, sender);
});

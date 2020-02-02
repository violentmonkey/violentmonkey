import { debounce } from '#/common';
import { INJECT_AUTO, INJECT_PAGE } from '#/common/consts';
import defaults from '#/common/options-defaults';
import storage from '#/common/storage';
import ua from '#/common/ua';
import { getScripts } from './db';
import { postInitialize } from './init';
import { getOption, hookOptions } from './options';

const SCRIPT_PREFIX = '/injected-web-';
let invokeApi;
let pageModePreferred; // true when global defaultInjectInto option is 'auto' or 'page'
let pageModeNeeded; // current final verdict

const isPageMode = m => (m ? m === INJECT_AUTO || m === INJECT_PAGE : pageModePreferred);

if (ua.isChrome) {
  // in Chrome the script starts before the standard content_scripts
  const scriptPath = `${SCRIPT_PREFIX}chrome.js`;
  const api = global.chrome.declarativeContent;
  const apiEvent = api.onPageChanged;
  const apiConfig = [{
    id: scriptPath,
    conditions: [
      new api.PageStateMatcher({
        pageUrl: { urlContains: '://' }, // essentially like <all_urls>
      }),
    ],
    actions: [
      new api.RequestContentScript({
        js: [scriptPath],
        allFrames: true,
      }),
    ],
  }];
  invokeApi = () => {
    if (pageModeNeeded) apiEvent.removeRules([scriptPath]);
    else apiEvent.addRules(apiConfig);
  };
  // Chrome preserves rules across restarts
  apiEvent.getRules([scriptPath], rules => {
    pageModeNeeded = !rules.length;
  });
} else {
  // in Firefox the script starts after the standard content_scripts
  const apiConfig = {
    js: [{ file: `${SCRIPT_PREFIX}firefox.js` }],
    runAt: 'document_start',
    matches: ['<all_urls>'],
    allFrames: true,
  };
  let reg;
  invokeApi = async () => {
    if (!pageModeNeeded) {
      reg?.unregister();
      reg = null;
    } else if (!reg) {
      reg = await browser.contentScripts.register(apiConfig);
    }
  };
  // enable the sandbox for a short time until the current options are read
  pageModeNeeded = isPageMode(defaults.defaultInjectInto);
  invokeApi();
}

const updateDecisionLater = debounce(() => {
  const newState = getScripts()
  .some(script => script.config.enabled && isPageMode(script.meta.injectInto));
  if (pageModeNeeded !== newState) {
    pageModeNeeded = newState;
    invokeApi();
  }
});

postInitialize.push(() => {
  storage.script.onDump.hook(updateDecisionLater);
  pageModePreferred = isPageMode(getOption('defaultInjectInto'));
  updateDecisionLater();
  hookOptions(({ defaultInjectInto }) => {
    if (defaultInjectInto) {
      const newState = isPageMode(defaultInjectInto);
      if (pageModePreferred !== newState) {
        pageModePreferred = newState;
        updateDecisionLater();
      }
    }
  });
});

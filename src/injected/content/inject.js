import {
  INJECT_AUTO,
  INJECT_CONTENT,
  INJECT_MAPPING,
  INJECT_PAGE,
  browser,
} from '#/common/consts';
import { getUniqId, sendCmd } from '#/common';

import { attachFunction } from '../utils';
import {
  forEach, join, append, createElementNS, NS_HTML,
  charCodeAt, fromCharCode,
} from '../utils/helpers';
import bridge from './bridge';

// Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1408996
const VMInitInjection = window[process.env.INIT_FUNC_NAME];
delete window[process.env.INIT_FUNC_NAME];

const { encodeURIComponent } = global;
const { replace } = String.prototype;
const { remove } = Element.prototype;

bridge.addHandlers({
  Inject: injectScript,
  InjectMulti: data => data::forEach(injectScript),
});

export default function injectScripts(contentId, webId, data) {
  const injectPage = [];
  const injectContent = [];
  const scriptLists = {
    [INJECT_PAGE]: injectPage,
    [INJECT_CONTENT]: injectContent,
  };
  let { scripts } = data;
  scripts = scripts.filter(({ meta, props, config }) => {
    if (!meta.noframes || window.top === window) {
      bridge.ids.push(props.id);
      if (config.enabled) {
        bridge.enabledIds.push(props.id);
        return true;
      }
    }
    return false;
  });
  let injectable;
  const injectChecking = {
    // eslint-disable-next-line no-return-assign
    [INJECT_PAGE]: () => injectable ?? (injectable = checkInjectable()),
    [INJECT_CONTENT]: () => true,
  };
  scripts.forEach((script) => {
    const injectInto = script.custom.injectInto || script.meta.injectInto || data.injectInto;
    const internalInjectInto = INJECT_MAPPING[injectInto] || INJECT_MAPPING[INJECT_AUTO];
    const availableInjectInto = internalInjectInto.find(key => injectChecking[key]?.());
    scriptLists[availableInjectInto]?.push({ script, injectInto: availableInjectInto });
  });
  const args = [
    webId,
    contentId,
    data.ua,
    data.isFirefox,
  ];
  if (injectContent.length) {
    const invokeGuest = VMInitInjection()(...args, bridge.onHandle);
    const postViaBridge = bridge.post;
    bridge.invokableIds.push(...injectContent.map(({ script }) => script.props.id));
    bridge.post = (cmd, params, realm) => {
      (realm === INJECT_CONTENT ? invokeGuest : postViaBridge)({ cmd, data: params });
    };
    bridge.post('LoadScripts', {
      ...data,
      mode: INJECT_CONTENT,
      items: injectContent,
    }, INJECT_CONTENT);
  }
  if (injectPage.length) {
    inject(`(${VMInitInjection}())(${JSON.stringify(args).slice(1, -1)})`,
      `${window.location.origin}/Violentmonkey.sandbox.js`);
    bridge.post('LoadScripts', {
      ...data,
      mode: INJECT_PAGE,
      items: injectPage,
    });
  }
}

function checkInjectable() {
  // Check default namespace, `a.style` only exists in HTML namespace
  if (!('style' in document.createElement('a'))) return false;
  const id = getUniqId('VM-');
  const detect = (domId) => {
    const a = document.createElement('a');
    a.id = domId;
    document.documentElement.appendChild(a);
  };
  inject(`(${detect})(${JSON.stringify(id)})`);
  const a = document.querySelector(`#${id}`);
  const injectable = !!a;
  if (a) a.remove();
  return injectable;
}

const injectedScriptIntro = `(${
  (attach, id, cb, callbackId) => {
    attach(id, cb);
    const callback = window[callbackId];
    if (callback) callback();
  }
})(${attachFunction},`;

// fullwidth range starts at 0xFF00
// normal range starts at space char code 0x20
const replaceWithFullWidthForm = s => fromCharCode(s::charCodeAt(0) - 0x20 + 0xFF00);

function injectScript(data) {
  const [vId, codeSlices, vCallbackId, mode, scriptId, scriptName] = data;
  // trying to avoid string concatenation of potentially huge code slices as long as possible
  const injectedCode = [
    injectedScriptIntro,
    `"${vId}",`,
    ...codeSlices,
    `,"${vCallbackId}");`,
  ];
  // using fullwidth forms for special chars and those added by the newer RFC3986 spec for URI
  const name = encodeURIComponent(scriptName::replace(/[#&',/:;?@=]/g, replaceWithFullWidthForm));
  const sourceUrl = browser.extension.getURL(`${name}.user.js#${scriptId}`);
  if (mode === INJECT_CONTENT) {
    injectedCode.push(
      ';0\n//# sourceURL=', // Firefox: the injected script must return 0 at the end
      sourceUrl,
    );
    sendCmd('InjectScript', injectedCode::join(''));
  } else {
    inject(injectedCode, sourceUrl);
  }
}

function inject(code, sourceUrl) {
  const script = document::createElementNS(NS_HTML, 'script');
  // avoid string concatenation of |code| as it can be extremely long
  script::append(
    'document.currentScript.remove();',
    ...typeof code === 'string' ? [code] : code,
    ...sourceUrl ? ['\n//# sourceURL=', sourceUrl] : [],
  );
  document.documentElement::append(script);
  script::remove();
}

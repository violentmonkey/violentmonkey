import {
  INJECT_AUTO,
  INJECT_CONTENT,
  INJECT_MAPPING,
  INJECT_PAGE,
  browser,
} from '#/common/consts';
import { sendCmd } from '#/common';

import {
  forEach, join, append, createElementNS, defineProperty, describeProperty, NS_HTML, DocProto,
  charCodeAt, fromCharCode, replace, remove,
} from '../utils/helpers';
import bridge from './bridge';

// Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1408996
const VMInitInjection = window[Symbol.for(process.env.INIT_FUNC_NAME)];
// To avoid running repeatedly due to new `document.documentElement`
// (the symbol is undeletable so a userscript can't fool us on reinjection)
defineProperty(window, Symbol.for(process.env.INIT_FUNC_NAME), { value: 1 });

const { encodeURIComponent, document } = global;
// Userscripts in content mode may redefine head and documentElement
const { get: getHead } = describeProperty(DocProto, 'head');
const { get: getDocElem } = describeProperty(DocProto, 'documentElement');
const { appendChild } = DocProto; // same as Node.appendChild

bridge.addHandlers({
  Inject: injectScript,
  InjectMulti: data => data::forEach(injectScript),
});

export function injectPageSandbox(contentId, webId) {
  inject(`(${VMInitInjection}())('${webId}','${contentId}')`,
    browser.runtime.getURL('sandbox/injected-web.js'));
}

export function injectScripts(contentId, webId, data, isXml) {
  // eslint-disable-next-line prefer-rest-params
  if (!document::getDocElem()) return waitForDocElem(() => injectScripts(...arguments));
  const injectPage = [];
  const injectContent = [];
  const scriptLists = {
    [INJECT_PAGE]: injectPage,
    [INJECT_CONTENT]: injectContent,
  };
  bridge.ids = data.ids;
  let injectable = isXml ? false : null;
  const injectChecking = {
    // eslint-disable-next-line no-return-assign
    [INJECT_PAGE]: () => injectable ?? (injectable = checkInjectable()),
    [INJECT_CONTENT]: () => true,
  };
  data.scripts.forEach((script) => {
    const injectInto = script.custom.injectInto || script.meta.injectInto || data.injectInto;
    const internalInjectInto = INJECT_MAPPING[injectInto] || INJECT_MAPPING[INJECT_AUTO];
    const availableInjectInto = internalInjectInto.find(key => injectChecking[key]?.());
    scriptLists[availableInjectInto]?.push({ script, injectInto: availableInjectInto });
  });
  if (injectContent.length) {
    const invokeGuest = VMInitInjection()(webId, contentId, bridge.onHandle);
    const postViaBridge = bridge.post;
    bridge.invokableIds.push(...injectContent.map(({ script }) => script.props.id));
    bridge.post = (cmd, params, realm) => {
      (realm === INJECT_CONTENT ? invokeGuest : postViaBridge)(cmd, params);
    };
    bridge.post('LoadScripts', {
      ...data,
      mode: INJECT_CONTENT,
      items: injectContent,
    }, INJECT_CONTENT);
  }
  if (injectPage.length) {
    bridge.post('LoadScripts', {
      ...data,
      mode: INJECT_PAGE,
      items: injectPage,
    });
  }
}

function checkInjectable() {
  let res = false;
  bridge.addHandlers({
    Pong() {
      res = true;
    },
  });
  bridge.post('Ping');
  return res;
}

function waitForDocElem(cb) {
  const observer = new MutationObserver(() => {
    if (document::getDocElem()) {
      observer.disconnect();
      cb();
    }
  });
  observer.observe(document, { childList: true });
}

// fullwidth range starts at 0xFF00
// normal range starts at space char code 0x20
const replaceWithFullWidthForm = s => fromCharCode(s::charCodeAt(0) - 0x20 + 0xFF00);

function injectScript([codeSlices, mode, scriptId, scriptName]) {
  // using fullwidth forms for special chars and those added by the newer RFC3986 spec for URI
  const name = encodeURIComponent(scriptName::replace(/[#&',/:;?@=]/g, replaceWithFullWidthForm));
  const sourceUrl = browser.extension.getURL(`${name}.user.js#${scriptId}`);
  // trying to avoid string concatenation of potentially huge code slices for as long as possible
  if (mode === INJECT_CONTENT) {
    // Firefox: the injected script must return 0 at the end
    codeSlices.push(`;0\n//# sourceURL=${sourceUrl}`);
    sendCmd('InjectScript', codeSlices::join(''));
  } else {
    inject(codeSlices, sourceUrl);
  }
}

function inject(code, sourceUrl) {
  const script = document::createElementNS(NS_HTML, 'script');
  // avoid string concatenation of |code| as it can be extremely long
  script::append(
    ...typeof code === 'string' ? [code] : code,
    ...sourceUrl ? ['\n//# sourceURL=', sourceUrl] : [],
  );
  // When using declarativeContent there's no documentElement so we'll append to `document`
  if (!appendToRoot(script)) document::appendChild(script);
  script::remove();
}

export function appendToRoot(node) {
  // DOM spec allows any elements under documentElement
  // https://dom.spec.whatwg.org/#node-trees
  const root = document::getHead() || document::getDocElem();
  return root && root::appendChild(node);
}

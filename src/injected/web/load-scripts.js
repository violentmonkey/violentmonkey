import { getUniqId } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import {
  filter, map, join, defineProperty, describeProperty, Boolean, Promise, setTimeout, log, noop,
} from '../utils/helpers';
import bridge from './bridge';
import store from './store';
import { deletePropsCache, wrapGM } from './gm-wrapper';

const { concat } = Array.prototype;
const { document } = global;
const { get: getCurrentScript } = describeProperty(Document.prototype, 'currentScript');
const { remove } = Element.prototype;

bridge.addHandlers({
  LoadScripts(data) {
    if (data.mode !== bridge.mode) return;
    const start = [];
    const idle = [];
    const end = [];
    bridge.isFirefox = data.isFirefox;
    bridge.ua = data.ua;
    bridge.version = data.version;
    if ([
      'greasyfork.org',
    ].includes(window.location.host)) {
      exposeVM();
    }
    // reset load and checkLoad
    bridge.load = () => {
      bridge.load = noop;
      run(end);
      setTimeout(runIdle);
    };
    // Firefox doesn't display errors in content scripts https://bugzil.la/1410932
    const isFirefoxContentMode = bridge.isFirefox && bridge.mode === INJECT_CONTENT;
    const listMap = {
      'document-start': start,
      'document-idle': idle,
      'document-end': end,
    };
    if (data.items) {
      data.items.forEach((item) => {
        const { script } = item;
        const runAt = script.custom.runAt || script.meta.runAt;
        const list = listMap[runAt] || end;
        list.push(item);
        store.values[script.props.id] = data.values[script.props.id];
      });
      run(start);
    }
    if (!store.state && ['interactive', 'complete'].includes(document.readyState)) {
      store.state = 1;
    }
    if (store.state) bridge.load();

    function buildCode({ script, injectInto }) {
      const pathMap = script.custom.pathMap || {};
      const requireKeys = script.meta.require || [];
      const requires = requireKeys::map(key => data.require[pathMap[key] || key])::filter(Boolean);
      const scriptId = script.props.id;
      const code = data.code[scriptId] || '';
      const { gm, thisObj, keys } = wrapGM(script, code, data.cache, injectInto);
      const id = getUniqId('VMin');
      const codeSlices = [
        `window["${id}"]=function(${
          keys::join(',')
        }){${
          isFirefoxContentMode
            ? 'try{'
            : ''
        }${
          keys::map(name => `this["${name}"]=${name};`)::join('')
        }with(this){((define,module,exports)=>{`,
        // 1. trying to avoid string concatenation of potentially huge code slices
        // 2. adding `;` on a new line in case some required script ends with a line comment
        ...[]::concat(...requires::map(req => [req, '\n;'])),
        '(()=>{',
        code,
        // adding a new line in case the code ends with a line comment
        `\n})()})()}${
          isFirefoxContentMode
            ? '}catch(e){console.error(e)}'
            : ''
        }}`,
      ];
      const name = script.custom.name || script.meta.name || scriptId;
      const args = keys::map(key => gm[key]);
      defineProperty(window, id, {
        configurable: true,
        set(func) {
          delete window[id];
          const el = document::getCurrentScript();
          if (el) el::remove();
          runCode(name, func, args, thisObj);
        },
      });
      return [codeSlices, bridge.mode, scriptId, script.meta.name];
    }

    function run(list) {
      bridge.post('InjectMulti', list::map(buildCode));
      list.length = 0;
    }

    async function runIdle() {
      for (const script of idle) {
        bridge.post('Inject', buildCode(script));
        await new Promise(setTimeout);
      }
      deletePropsCache();
      idle.length = 0;
    }
  },
});

function runCode(name, func, args, thisObj) {
  if (process.env.DEBUG) {
    log('info', [bridge.mode], name);
  }
  func.apply(thisObj, args);
}

// polyfills for Firefox's Components.utils functions exposed to userscripts

function exposeVM() {
  const Violentmonkey = {};
  const checking = {};
  let key = 0;
  bridge.addHandlers({
    ScriptChecked({ callback, result }) {
      const cb = checking[callback];
      if (cb) {
        cb(result);
        delete checking[callback];
      }
    },
  });
  defineProperty(Violentmonkey, 'getVersion', {
    value: () => Promise.resolve({
      version: bridge.version,
    }),
  });
  defineProperty(Violentmonkey, 'isInstalled', {
    value: (name, namespace) => new Promise((resolve) => {
      key += 1;
      const callback = key;
      checking[callback] = resolve;
      bridge.post('CheckScript', { name, namespace, callback });
    }),
  });
  defineProperty(window.external, 'Violentmonkey', {
    value: Violentmonkey,
  });
}

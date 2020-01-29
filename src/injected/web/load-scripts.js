import { getUniqId } from '#/common';
import { INJECT_CONTENT } from '#/common/consts';
import {
  filter, map, defineProperty, describeProperty, Boolean, Promise, setTimeout, log, noop,
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
      const requiresSlices = []::concat(...requires::map(req => [req, '\n;']));
      const scriptId = script.props.id;
      const code = data.code[scriptId] || '';
      const thisObj = wrapGM(script, code, data.cache, injectInto);
      const id = getUniqId('VMin');
      const codeSlices = [
        `(function(){${
          isFirefoxContentMode
            ? 'try{'
            : ''
        // hiding module interface from @require'd scripts so they don't mistakenly use it
        }with(this)((define,module,exports)=>{`,
        // 1. trying to avoid string concatenation of potentially huge code slices
        // 2. adding `;` on a new line in case some required script ends with a line comment
        ...requiresSlices,
        // 3. adding a nested IIFE to support 'use strict' in the code when there are @requires
        ...requiresSlices.length ? ['(()=>{'] : [],
        code,
        // adding a new line in case the code ends with a line comment
        `\n${
          requiresSlices.length ? '})()' : ''
        }})()${
          isFirefoxContentMode
            ? '}catch(e){console.error(e)}'
            : ''
        }}).call(${id})`,
      ];
      exposeThisObj(thisObj, id, process.env.DEBUG && script);
      return [codeSlices, bridge.mode, scriptId, script.meta.name];
    }
    function exposeThisObj(thisObj, id, script) {
      defineProperty(window, id, {
        configurable: true,
        get() {
          if (process.env.DEBUG) {
            log('info', [bridge.mode], script.custom.name || script.meta.name || script.props.id);
          }
          const el = document::getCurrentScript();
          if (el) el::remove();
          delete window[id];
          return thisObj;
        },
      });
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

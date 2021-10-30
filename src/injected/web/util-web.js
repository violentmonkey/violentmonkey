import { createNullObj } from '../util';
import bridge from '#/injected/web/bridge';
import { INJECT_CONTENT } from '#/common/consts';

// Firefox defines `isFinite` on `global` not on `window`
const { isFinite } = global; // eslint-disable-line no-restricted-properties
const { toString: numberToString } = 0;
/**
 * Using duck typing for #565 steamcommunity.com has overridden `Array.prototype`
 * If prototype is modified Object.prototype.toString.call(obj) won't give '[object Array]'
 */
const isArray = obj => obj
  && typeof obj.length === 'number'
  && typeof obj.splice === 'function';
// Reference: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/JSON#Polyfill
const escMap = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};
const escRE = /[\\"\u0000-\u001F\u2028\u2029]/g; // eslint-disable-line no-control-regex
const escFunc = m => escMap[m] || `\\u${(m::charCodeAt(0) + 0x10000)::numberToString(16)::slice(1)}`;
/**
 * When running in the page context we must beware of sites that override Array#toJSON
 * leading to an invalid result, which is why our jsonDump() ignores toJSON.
 * Thus, we use the native JSON.stringify() only in the content script context and only until
 * a userscript is injected into this context (due to `@inject-into` and/or a CSP problem).
 */
export const jsonDump = value => {
  if (value == null) return 'null';
  let res;
  switch (typeof value) {
  case 'bigint':
  case 'number':
    res = isFinite(value) ? `${value}` : 'null';
    break;
  case 'boolean':
    res = `${value}`;
    break;
  case 'string':
    res = `"${value::replace(escRE, escFunc)}"`;
    break;
  case 'object':
    if (isArray(value)) {
      res = '[';
      value::forEach(v => { res += `${res.length > 1 ? ',' : ''}${jsonDump(v) ?? 'null'}`; });
      res += ']';
    } else {
      res = '{';
      objectKeys(value)::forEach(key => {
        const v = jsonDump(value[key]);
        // JSON.stringify skips keys with `undefined` or incompatible values
        if (v !== undefined) {
          res += `${res.length > 1 ? ',' : ''}${jsonDump(key)}:${v}`;
        }
      });
      res += '}';
    }
    break;
  default:
  }
  return res;
};

/**
 * 2x faster than `Set`, 5x faster than flat object
 * @param {Object} [hubs]
 */
export const FastLookup = (hubs = createNullObj()) => {
  /** @namespace FastLookup */
  return {
    add(val) {
      getHub(val, true)[val] = true;
    },
    clone() {
      const clone = createNullObj();
      for (const group in hubs) { /* proto is null */// eslint-disable-line guard-for-in
        clone[group] = assign(createNullObj(), hubs[group]);
      }
      return FastLookup(clone);
    },
    delete(val) {
      delete getHub(val)?.[val];
    },
    has: val => getHub(val)?.[val],
    toArray: () => concat::apply([], objectValues(hubs)::map(objectKeys)),
  };
  function getHub(val, autoCreate) {
    const group = val.length ? val[0] : ''; // length is unforgeable, index getters aren't
    const hub = hubs[group] || (
      autoCreate ? (hubs[group] = createNullObj())
        : null
    );
    return hub;
  }
};

/**
 * Adding the polyfills in Chrome (always as it doesn't provide them)
 * and in Firefox page mode (while preserving the native ones in content mode)
 * for compatibility with many [old] scripts that use these utils blindly
 */
export const makeComponentUtils = () => {
  const {
    cloneInto = obj => obj,
    createObjectIn = (targetScope, { defineAs } = {}) => {
      const obj = {};
      if (defineAs) targetScope[defineAs] = obj;
      return obj;
    },
    exportFunction = (func, targetScope, { defineAs } = {}) => {
      if (defineAs) targetScope[defineAs] = func;
      return func;
    },
  } = IS_FIREFOX && bridge.mode === INJECT_CONTENT
    ? global
    : createNullObj();
  return {
    cloneInto,
    createObjectIn,
    exportFunction,
  };
};

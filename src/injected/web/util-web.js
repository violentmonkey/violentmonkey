import { INJECT_CONTENT } from '../util';
import bridge from './bridge';

// Reference: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/JSON#Polyfill
const escMap = {
  __proto__: null,
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};
// TODO: handle \u2028\u2029 when Chrome's JSON.stringify starts to escape them
const escRE = /[\\"\u0000-\u001F]/g; // eslint-disable-line no-control-regex
const hex = '0123456789ABCDEF';
const escCharCode = num => `\\u00${
  hex[num >> 4] // eslint-disable-line no-bitwise
}${
  hex[num % 16]
}`;
const escFunc = m => escMap[m] || escCharCode(m::charCodeAt(0));
/**
 * When running in the page context we must beware of sites that override Array#toJSON
 * leading to an invalid result, which is why our jsonDump() ignores toJSON.
 * Thus, we use the native JSON.stringify() only in the content script context and only until
 * a userscript is injected into this context (due to `@inject-into` and/or a CSP problem).
 */
export const jsonDump = (value, stack) => {
  let res;
  switch (value === null ? (res = 'null') : typeof value) {
  case 'bigint':
  case 'number':
    res = safeIsFinite(value) ? `${value}` : 'null';
    break;
  case 'boolean':
    res = `${value}`;
    break;
  case 'string':
    res = `"${value::replace(escRE, escFunc)}"`;
    break;
  case 'object':
    if (!stack) {
      stack = []; // Creating the array here, only when type is object.
    }
    if (stack::indexOf(value) >= 0) {
      throw new ErrorSafe('Converting circular structure to JSON');
    }
    setOwnProp(stack, stack.length, value);
    if (ArrayIsArray(value)) {
      res = '[';
      // Must enumerate all values to include holes in sparse arrays
      for (let i = 0, len = value.length; i < len; i += 1) {
        res += `${i ? ',' : ''}${jsonDump(value[i], stack) ?? 'null'}`;
      }
      res += ']';
    } else {
      res = '{';
      objectKeys(value)::forEach((key) => {
        const v = jsonDump(value[key], stack);
        // JSON.stringify skips keys with `undefined` or incompatible values
        if (v !== undefined) {
          res += `${res.length > 1 ? ',' : ''}${jsonDump(key)}:${v}`;
        }
      });
      res += '}';
    }
    stack.length -= 1;
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
    toArray: () => {
      const values = objectValues(hubs);
      values::forEach((val, i) => { values[i] = objectKeys(val); });
      return concat::apply([], values);
    },
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
  const CLONE_INTO = 'cloneInto';
  const CREATE_OBJECT_IN = 'createObjectIn';
  const EXPORT_FUNCTION = 'exportFunction';
  const src = IS_FIREFOX && bridge.mode === INJECT_CONTENT && global;
  const defineIn = !src && ((target, as, val) => {
    if (as && (as = getOwnProp(as, 'defineAs'))) {
      setOwnProp(target, as, val);
    }
    return val;
  });
  return {
    [CLONE_INTO]: src && src[CLONE_INTO] || (
      obj => obj
    ),
    [CREATE_OBJECT_IN]: src && src[CREATE_OBJECT_IN] || (
      (target, as) => defineIn(target, as, {})
    ),
    [EXPORT_FUNCTION]: src && src[EXPORT_FUNCTION] || (
      (func, target, as) => defineIn(target, as, func)
    ),
  };
};

import { FastLookup, safeConcat } from './util';

const scopeSym = SafeSymbol.unscopables;
/** Original ~50 global functions such as setTimeout that some sites override.
 * Not saving all globals because it would waste a lot of time on each page and frame. */
const globalFunctionDesc = createNullObj();
const globalKeysSet = FastLookup();
const globalKeys = (function makeGlobalKeys() {
  const kWrappedJSObject = 'wrappedJSObject';
  const isContentMode = !PAGE_MODE_HANDSHAKE;
  const names = builtinGlobals[0]; // `window` keys
  const numFrames = window::getWindowLength();
  // True if `names` is usable as is, but FF is bugged: its names have duplicates
  let ok = !IS_FIREFOX;
  let desc;
  for (const key of names) {
    if (+key >= 0 && key < numFrames
      || isContentMode && (
        key === process.env.INIT_FUNC_NAME || key === 'browser' || key === 'chrome'
      )
    ) {
      ok = false;
    } else {
      globalKeysSet.set(key, 1);
      if (key >= 'a' && key <= 'z'
      && (desc = describeProperty(window, key))
      && desc.enumerable && isFunction(desc.value)) {
        globalFunctionDesc[key] = desc;
      }
    }
  }
  /* Chrome and FF page mode: `global` is `window`
     FF content mode: `global` is different, some props e.g. `isFinite` are defined only there */
  if (global !== window) {
    builtinGlobals[1]::forEach(key => {
      if (!(+key >= 0 && key < numFrames)) {
        // Using `!` to avoid the need to use and safe-guard isNaN
        globalKeysSet.set(key, -1);
        ok = false;
      }
    });
  }
  // wrappedJSObject is not included in getOwnPropertyNames so we add it explicitly.
  if (IS_FIREFOX
  && !PAGE_MODE_HANDSHAKE
  && kWrappedJSObject in global
  && !globalKeysSet.get(kWrappedJSObject)) {
    globalKeysSet.set(kWrappedJSObject, 1);
    if (ok) setOwnProp(names, names.length, kWrappedJSObject);
  }
  return ok ? names : globalKeysSet.toArray();
}());
const inheritedKeys = createNullObj();
const globalDesc = createNullObj();
const updateGlobalDesc = name => {
  let src;
  let desc;
  let descFn;
  if ((descFn = globalFunctionDesc[name]) && (src = window)
  || (src = inheritedKeys[name])
  || (src = globalKeysSet.get(name)) && (src = src > 0 ? window : global)) {
    if ((desc = descFn || describeProperty(src, name))) {
      desc = nullObjFrom(desc);
      /* ~45 enumerable action functions belong to `window` and need to be bound to it,
       * the non-enum ~10 can be unbound, and `eval` MUST be unbound to run in scope. */
      if (descFn) {
        // TODO: switch to SafeProxy and preserve thisArg when it's not our wrapper or its cache?
        desc.value = defineProperty(
          safeBind(desc.value, src === global ? global : window),
          'name',
          { __proto__: null, value: name }
        );
        globalFunctionDesc[name] = undefined;
        globalDesc[name] = desc;
      } else if (!(+name >= 0 && name < window::getWindowLength())) {
        // Using `!` to avoid the need to use and safe-guard isNaN
        globalDesc[name] = desc;
      }
      return desc;
    }
  }
};
[SafeEventTarget, Object]::forEach(src => {
  src = src[PROTO];
  for (const key of reflectOwnKeys(src)) {
    const desc = describeProperty(src, key);
    (isFunction(desc.value) ? globalFunctionDesc : inheritedKeys)[key] = desc;
  }
});
builtinGlobals = null; // eslint-disable-line no-global-assign

/**
 * @desc Wrap helpers to prevent unexpected modifications.
 */
export function makeGlobalWrapper(local) {
  let globals = globalKeysSet; // will be copied only if modified
  /* Browsers may return [object Object] for Object.prototype.toString(window)
     on our `window` proxy so jQuery libs see it as a plain object and throw
     when trying to clone its recursive properties like `self` and `window`. */
  setOwnProp(local, toStringTagSym, () => 'Window', false, 'get');
  const events = createNullObj();
  const wrapper = new SafeProxy(local, {
    __proto__: null,
    defineProperty(_, name, desc) {
      if (name in local
      || !(_ = globalDesc[name] || updateGlobalDesc(name))
      || _.configurable) {
        /* It's up to caller to protect proto */// eslint-disable-next-line no-restricted-syntax
        return defineProperty(local, name, desc);
      }
    },
    deleteProperty(_, name) {
      if ((_ = delete local[name])
      && (_ = globalDesc[name] || updateGlobalDesc(name))
      && (_ = _.configurable)) {
        if (globals === globalKeysSet) {
          globals = globalKeysSet.clone();
        }
        globals.delete(name);
      }
      return !!_;
    },
    get: (_, name) => {
      if (name === 'undefined' || name === scopeSym) return;
      if ((_ = local[name]) !== undefined || name in local) return _;
      return proxyDescribe(local, name, wrapper, events) && local[name];
    },
    getOwnPropertyDescriptor: (_, name) => describeProperty(local, name)
      || proxyDescribe(local, name, wrapper, events),
    has: (_, name) => name in globalDesc || name in local || updateGlobalDesc(name),
    ownKeys: () => makeOwnKeys(local, globals),
    preventExtensions() {},
    set(_, name, value) {
      if (!(name in local)) proxyDescribe(local, name, wrapper, events);
      local[name] = value;
      return true;
    },
  });
  return wrapper;
}

function makeOwnKeys(local, globals) {
  /** Note that arrays can be eavesdropped via prototype setters like '0','1',...
   * on `push` and `arr[i] = 123`, as well as via getters if you read beyond
   * its length or from an unassigned `hole`. */
  const frameIndexes = [];
  const len = window::getWindowLength();
  for (let i = 0, str; i < len && getOwnProp(window, str = `${i}`); i += 1) {
    if (!(str in local)) safePush(frameIndexes, str);
  }
  return safeConcat(
    frameIndexes,
    globals === globalKeysSet ? globalKeys : globals.toArray(),
    reflectOwnKeys(local)::filter(notIncludedIn, globals.get),
  );
}

function proxyDescribe(local, name, wrapper, events) {
  let desc = globalDesc[name] || updateGlobalDesc(name);
  if (!desc) return;
  const { get, set, value } = desc;
  const isWindow = value === window
    || name === 'window'
    || name === 'self'
    || name === 'globalThis'
    || name === 'top' && window === top // `top` is unforgeable
    || name === 'parent' && window === window::getWindowParent();
  if (isWindow) {
    desc.value = wrapper;
    delete desc.get;
    delete desc.set;
  } else if (get && set && typeof name === 'string'
    // Spoofed String index getters won't be called within length, length itself is unforgeable
    && name.length >= 3 && name[0] === 'o' && name[1] === 'n'
  ) {
    setWindowEvent(desc, name, events, wrapper);
  } else {
    if (get) desc.get = safeBind(get, window);
    if (set) desc.set = safeBind(set, window);
  }
  defineProperty(local, name, desc); /* proto is null */// eslint-disable-line no-restricted-syntax
  return desc;
}

function setWindowEvent(desc, name, events, wrapper) {
  name = name::slice(2);
  desc.get = () => events[name] || null;
  desc.set = fn => {
    window::off(name, events[name]);
    if (isFunction(fn)) {
      // the handler will be unique so that one script couldn't remove something global
      // like console.log set by another script
      window::on(name, events[name] = (
        // FF chokes on safeBind because the result belongs to Vault's window
        IS_FIREFOX && PAGE_MODE_HANDSHAKE
          ? evt => wrapper::fn(evt)
          : safeBind(fn, wrapper)
      ));
    } else {
      delete events[name];
    }
  };
}

/** @this {FastLookup.get} */
function notIncludedIn(key) {
  return !this(key);
}

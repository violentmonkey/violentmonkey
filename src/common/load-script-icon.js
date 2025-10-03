import { isDataUri, isValidHttpUrl, noop, sendCmdDirectly } from '@/common';

// TODO: convert this into a component tag e.g. <safe-icon>
const KEY = 'safeIcon';
const KEY_DEFAULT = 'noIcon';

/**
 * Sets script's safeIcon property after the image is successfully loaded
 * @param {VMScript} script
 * @param {{cache?:{}, isHiDPI?:boolean}} [store]
 * @param {boolean} [showDefault]
 */
export async function loadScriptIcon(script, store, showDefault) {
  let def;
  const { icon: customIcon, pathMap } = script.custom || {};
  const icon = customIcon || script.meta.icon;
  const { cache = {}, isHiDPI } = store || {};
  const url = pathMap?.[icon] || icon || showDefault && (
    def = `${ICON_PREFIX}${isHiDPI && 128 || (script.config.removed ? 32 : 38)}.png`
  );
  if (!url || url !== script[KEY]) {
    // exposing scripts with no icon for user's CustomCSS
    script[KEY_DEFAULT] = def ? '' : null;
    // creates an observable property so Vue will see the change after `await`
    if (!(KEY in script)) {
      script[KEY] = null;
    }
    if (url) {
      script[KEY] = cache[url]
        || isDataUri(url) && url
        || isHiDPI && def // Using our big icon directly as its data URI is rendered slower
        || (def || isValidHttpUrl(url))
          && (cache[url] = await sendCmdDirectly('GetImageData', url).catch(noop))
        || null;
    }
  }
  return script[KEY];
}

/**
 * Sets script's safeIcon property after the image is successfully loaded
 * @param {{}} cmdOpts
 * @param {{cache?:{}}} store
 */
export async function loadCommandIcon(cmdOpts, store) {
  const { icon } = cmdOpts;
  const cache = store.cache ??= {};
  if (icon && !(KEY in cmdOpts)) {
    cmdOpts[KEY] = null; // creating an observable property
    let url = cache[icon] || isDataUri(icon) && icon;
    if (!url && isValidHttpUrl(icon)) {
      url = cache[icon] = sendCmdDirectly('GetImageData', icon).catch(noop);
    }
    if (isObject(url)) url = await url;
    cmdOpts[KEY] = cache[icon] = url || null;
  }
}

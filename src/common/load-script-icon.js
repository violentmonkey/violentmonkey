import { isDataUri, isValidHttpUrl, noop, sendCmdDirectly } from '@/common/index';

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

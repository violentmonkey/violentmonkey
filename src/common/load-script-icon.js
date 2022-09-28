import { ICON_PREFIX } from '@/common/consts';
import { isDataUri, sendCmdDirectly } from '@/common/index';

// TODO: convert this into a component tag e.g. <safe-icon>
const KEY = 'safeIcon';

/**
 * Sets script's safeIcon property after the image is successfully loaded
 * @param {VMScript} script
 * @param {Object} [cache]
 * @param {number} [defSize] - show default icon of this size, -1 = auto, falsy = no
 */
export async function loadScriptIcon(script, cache = {}, defSize) {
  const { icon } = script.meta;
  const url = script.custom?.pathMap?.[icon] || icon
    || defSize && `${ICON_PREFIX}${defSize > 0 && defSize || (script.config.removed ? 32 : 38)}.png`;
  if (!url || url !== script[KEY]) {
    // creates an observable property so Vue will see the change after `await`
    if (!(KEY in script)) {
      script[KEY] = null;
    }
    if (url) {
      script[KEY] = cache[url]
        || isDataUri(url) && url
        || await sendCmdDirectly('GetImageData', url)
        || null;
    }
  }
  return script[KEY];
}

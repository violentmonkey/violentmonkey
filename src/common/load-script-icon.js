import { ICON_PREFIX } from '@/common/consts';
import { isDataUri, isRemote, sendCmdDirectly } from '@/common/index';

// TODO: convert this into a component tag e.g. <safe-icon>
const KEY = 'safeIcon';

/**
 * Sets script's safeIcon property after the image is successfully loaded
 * @param {VMScript} script
 * @param {Object} [cfg]
 * @param {Object} [cfg.cache]
 * @param {boolean} [cfg.isHiDPI] - to adjust size of the default icon
 */
export async function loadScriptIcon(script, { cache = {}, isHiDPI } = {}) {
  let def;
  const { icon } = script.meta;
  const url = script.custom?.pathMap?.[icon] || icon || (
    def = `${ICON_PREFIX}${isHiDPI && 128 || (script.config.removed ? 32 : 38)}.png`
  );
  if (!url || url !== script[KEY]) {
    // creates an observable property so Vue will see the change after `await`
    if (!(KEY in script)) {
      script[KEY] = null;
    }
    if (url) {
      script[KEY] = cache[url]
        || isDataUri(url) && url
        || isHiDPI && def // Using our big icon directly as its data URI is rendered slower
        || (def || isRemote(url)) && (cache[url] = await sendCmdDirectly('GetImageData', url))
        || null;
    }
  }
  return script[KEY];
}

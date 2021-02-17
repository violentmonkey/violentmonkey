import { sendCmdDirectly } from '#/common/index';

const KEY = 'safeIcon';

/**
 * Sets script's safeIcon property after the image is successfully loaded
 * @param {VMScript} script
 * @param {Object} [cache]
 */
export async function loadScriptIcon(script, cache = {}) {
  const { icon } = script.meta;
  const url = script.custom?.pathMap?.[icon] || icon;
  if (!url || url !== script[KEY]) {
    // creates an observable property so Vue will see the change after `await`
    script[KEY] = null;
    if (url) {
      script[KEY] = cache[url]
        || url.startsWith('data:') && url
        || await sendCmdDirectly('GetImageData', url)
        || null;
    }
  }
  return script[KEY];
}

const images = {};

/**
 * Sets script's safeIcon property after the image is successfully loaded
 * @param {VMScript} script
 * @param {Object} [_]
 * @param {?string} [_.default]
 * @param {string} [_.key]
 * @param {Object} [_.cache]
 * @returns {Promise<boolean>}
 */
export function loadScriptIcon(script, {
  default: defaultIcon = null,
  key = 'safeIcon',
  cache = {},
} = {}) {
  const { icon } = script.meta;
  const url = script.custom?.pathMap?.[icon] || icon;
  const isNewUrl = url !== script[key];
  let promise = isNewUrl && url ? images[url] : Promise.resolve(false);
  if (!promise) {
    promise = Promise.resolve(cache?.[url] || fetchImage(url));
    images[url] = promise;
  }
  if (isNewUrl || !url) {
    // creates an observable property so Vue will see the change in then()
    script[key] = defaultIcon;
    promise.then(ok => {
      script[key] = ok ? url : defaultIcon;
    });
  }
  return promise;
}

async function fetchImage(url) {
  try {
    const blob = await (await fetch(url)).blob();
    await createImageBitmap(blob);
    return true;
  } catch (e) {
    return false;
  }
}

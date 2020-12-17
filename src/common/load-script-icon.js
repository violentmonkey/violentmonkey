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
  /* The benefit of fetch+createImageBitmap is that it doesn't delay the popup in Chrome,
     but it doesn't work with SVG so we're using DOM Image in case the modern method fails
     or when the URL obviously contains an SVG */
  if (!/^data:image\/svg|\.svgz?([#?].*)?$/.test(url)) {
    try {
      const blob = await (await fetch(url)).blob();
      await createImageBitmap(blob);
      return true;
    } catch (e) { /* NOP */ }
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.src = url;
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
}

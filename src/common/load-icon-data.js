import { blob2base64 } from './util';

export default async function loadIconData(url, isOwn) {
  let res;
  let maxSize = !isOwn && (2 * 38); // dashboard icon size for 2xDPI
  try {
    const img = await createImageBitmap(await (await fetch(url)).blob(), isOwn ? {} : {
      resizeWidth: maxSize,
      resizeHeight: maxSize,
      resizeQuality: 'high',
    });
    let { width, height } = img;
    if (width && height) {  // TODO: check if FF reports 0 for SVG via createImageBitmap
      const canvas = __.MV3
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!__.MV3) {
        if (maxSize && (width > maxSize || height > maxSize)) {
          maxSize /= width > height ? width : height;
          width = Math.round(width * maxSize);
          height = Math.round(height * maxSize);
        }
        canvas.width = width;
        canvas.height = height;
      }
      ctx.drawImage(img, 0, 0, width, height);
      res = [
        __.MV3
          ? 'data:image/png;base64,' + await blob2base64(await canvas.convertToBlob())
          : canvas.toDataURL(),
        isOwn && ctx.getImageData(0, 0, width, height),
      ];
    }
  } catch (err) {
    if (__.DEV) console.log(loadIconData.name + ':', err);
  }
  return res || [url];
}

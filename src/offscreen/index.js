const { chrome } = globalThis;

async function handleSetClipboard(params) {
  try {
    await navigator.clipboard.writeText(params?.text ?? '');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: `${error}` };
  }
}

async function handleGetImageData(params) {
  try {
    const response = await fetch(params?.url);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const maxPixels = 1024 * 1024;
    if (bitmap.width * bitmap.height > maxPixels) {
      return { ok: false, error: 'Image too large to process.' };
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, error: 'Failed to get 2D context.' };
    }
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const dataBuffer = imageData.data.buffer.slice(
      imageData.data.byteOffset,
      imageData.data.byteOffset + imageData.data.byteLength,
    );
    const includeData = params?.includeData;
    const maxInlineBytes = params?.maxInlineBytes ?? 65536;
    const shouldInline = includeData || imageData.data.byteLength <= maxInlineBytes;
    return {
      ok: true,
      width: bitmap.width,
      height: bitmap.height,
      dataBuffer,
      byteOffset: 0,
      byteLength: imageData.data.byteLength,
      ...(shouldInline ? { data: Array.from(imageData.data) } : {}),
    };
  } catch (error) {
    return { ok: false, error: `${error}` };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.vm3Offscreen) return undefined;
  const { method, params, requestId } = message;
  const respond = async () => {
    let result;
    if (method === 'SetClipboard') {
      result = await handleSetClipboard(params);
    } else if (method === 'GetImageData') {
      result = await handleGetImageData(params);
    } else {
      result = { ok: false, error: `Unknown method: ${method}` };
    }
    sendResponse({ requestId, ...result });
  };
  respond();
  return true;
});

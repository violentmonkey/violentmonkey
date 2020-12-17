export function downloadUrl(url, name, callback) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  a.dispatchEvent(new MouseEvent('click'));
  if (callback) setTimeout(callback, 3000);
}

export function downloadBlob(blob, name, callback) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name, () => {
    URL.revokeObjectURL(url);
    if (callback) callback();
  });
}

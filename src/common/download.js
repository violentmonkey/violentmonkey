export function downloadUrl(url, name, callback) {
  const a = document.createElement('a');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.href = url;
  if (name) a.download = name;
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    if (callback) callback();
  }, 3000);
}

export function downloadBlob(blob, name, callback) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name, () => {
    URL.revokeObjectURL(url);
    if (callback) callback();
  });
}

let clipboardData;

function onCopy(e) {
  document.removeEventListener("copy", onCopy, true);
  e.stopImmediatePropagation();
  e.preventDefault();
  const { type, data } = clipboardData;
  e.clipboardData.setData(type || 'text/plain', data);
}

export default function setClipboard({ type, data }) {
  clipboardData = { type, data };
  document.addEventListener("copy", onCopy, true);
  const ret = document.execCommand('copy', false, null);
  if (!ret && process.env.DEBUG) {
    console.warn('Copy failed!');
  }
}

let clipboardData;

function onCopy(e) {
  e.stopImmediatePropagation();
  e.preventDefault();
  const { type, data } = clipboardData;
  e.clipboardData.setData(type || 'text/plain', data);
}

export default function setClipboard({ type, data }) {
  clipboardData = { type, data };
  document.addEventListener('copy', onCopy, false);
  const ret = document.execCommand('copy', false, null);
  document.removeEventListener('copy', onCopy, false);
  clipboardData = null;
  if (process.env.DEBUG && !ret) {
    console.warn('Copy failed!');
  }
}

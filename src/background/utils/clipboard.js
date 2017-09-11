const textarea = document.createElement('textarea');
document.body.appendChild(textarea);

let clipboardData;
function onCopy(e) {
  e.preventDefault();
  const { type, data } = clipboardData;
  e.clipboardData.setData(type || 'text/plain', data);
}
document.addEventListener('copy', onCopy, false);

export default function setClipboard(data) {
  clipboardData = data;
  textarea.focus();
  const ret = document.execCommand('copy', false, null);
  if (!ret && process.env.DEBUG) {
    console.warn('Copy failed!');
  }
}

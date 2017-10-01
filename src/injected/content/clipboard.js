let textarea;
let clipboardData;

function init() {
  textarea = document.createElement('textarea');
  textarea.style.position = 'absolute';
  textarea.style.width = 0;
  textarea.style.height = 0;
  textarea.style.left = '-20px';
}

function onCopy(e) {
  e.preventDefault();
  const { type, data } = clipboardData;
  e.clipboardData.setData(type || 'text/plain', data);
}

export default function setClipboard({ type, data }) {
  clipboardData = { type, data };
  if (!textarea) init();
  document.addEventListener('copy', onCopy, false);
  document.documentElement.appendChild(textarea);
  textarea.focus();
  const ret = document.execCommand('copy', false, null);
  document.documentElement.removeChild(textarea);
  document.removeEventListener('copy', onCopy, false);
  if (!ret && process.env.DEBUG) {
    console.warn('Copy failed!');
  }
}

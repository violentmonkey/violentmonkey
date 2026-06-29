let textarea, type, data;

export default function setClipboard(opts) {
  data = opts.data;
  type = opts.type;
  if (!textarea) {
    textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    addEventListener('copy', e => {
      e.preventDefault();
      e.clipboardData.setData(type || 'text/plain', data);
    });
  }
  textarea.focus();
  const ret = document.execCommand('copy');
  if (!ret && __.DEV) {
    console.warn('Copy failed!');
  }
}

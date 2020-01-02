import { commands } from './message';

const textarea = document.createElement('textarea');
let clipboardData;

Object.assign(commands, {
  SetClipboard(data) {
    clipboardData = data;
    textarea.focus();
    const ret = document.execCommand('copy', false, null);
    if (!ret && process.env.DEBUG) {
      console.warn('Copy failed!');
    }
  },
});

document.body.appendChild(textarea);

document.addEventListener('copy', e => {
  e.preventDefault();
  const { type, data } = clipboardData;
  e.clipboardData.setData(type || 'text/plain', data);
});

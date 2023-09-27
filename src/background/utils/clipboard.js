import { addPublicCommands } from './init';

const textarea = document.createElement('textarea');
let clipboardData;

addPublicCommands({
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

addEventListener('copy', e => {
  e.preventDefault();
  const { type, data } = clipboardData;
  e.clipboardData.setData(type || 'text/plain', data);
});

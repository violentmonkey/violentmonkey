import { addPublicCommands } from './init';

const canUseDomClipboard = typeof document !== 'undefined';
const textarea = canUseDomClipboard && document.createElement('textarea');
let clipboardData;

addPublicCommands({
  async SetClipboard(data) {
    clipboardData = data;
    if (!canUseDomClipboard) {
      if (data?.type && data.type !== 'text/plain') return;
      await navigator.clipboard?.writeText?.(`${data?.data || ''}`);
      return;
    }
    textarea.focus();
    const ret = document.execCommand('copy', false, null);
    if (!ret && process.env.DEBUG) {
      console.warn('Copy failed!');
    }
  },
});

if (canUseDomClipboard) {
  document.body.appendChild(textarea);

  addEventListener('copy', e => {
    e.preventDefault();
    const { type, data } = clipboardData;
    e.clipboardData.setData(type || 'text/plain', data);
  });
}

import { addPublicCommands } from './init';

async function writeClipboard({ data, type }) {
  const mime = type || 'text/plain';
  const blob = new Blob([data], { type: mime });
  // Prefer write() to preserve MIME type when available.
  if (navigator.clipboard?.write && globalThis.ClipboardItem) {
    await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
    return;
  }
  await navigator.clipboard?.writeText(data);
}

addPublicCommands({
  async SetClipboard(data) {
    try {
      await writeClipboard(data);
    } catch (err) {
      if (process.env.DEBUG) {
        console.warn('Copy failed!', err);
      }
    }
  },
});

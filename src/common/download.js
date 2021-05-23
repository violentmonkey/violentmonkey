import { makePause } from '#/common';

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  a.dispatchEvent(new MouseEvent('click'));
  makePause(3000).then(() => URL.revokeObjectURL(url));
}

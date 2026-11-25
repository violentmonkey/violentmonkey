import { NO_PROXY, onClientMessage, rejectPending, sendCmdTo } from './messaging-sw';
import { noop } from '.';

export const vmZipEntryName = 'violentmonkey';
export const kUserJs = '.user.js';
export const kOptionsJson = '.options.json';
export const kStorageJson = '.storage.json';

/**
 * @param {Blob | import('fflate').Zippable} data
 * @param {any} [opts]
 */
export async function zipOrUnzip(data, opts) {
  const path = __.PUBLIC_LIB + 'zip-worker.js';
  const worker = new Worker(path);
  worker.onerror = worker.onmessageerror = e => rejectPending(`${path}: ${e.message || 'error'}`);
  worker.onmessage = onClientMessage.bind(null, noop);
  try {
    return await sendCmdTo('', [data, opts], worker, null, NO_PROXY);
  } finally {
    worker.terminate();
  }
}

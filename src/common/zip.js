import { NO_PROXY, onClientMessage, rejectPending, sendCmdTo } from './messaging-sw';
import { noop } from '.';

export const vmZipEntryName = 'violentmonkey';
export const kUserJs = '.user.js';
export const kOptionsJson = '.options.json';
export const kStorageJson = '.storage.json';

/** @param {Blob | import('fflate').Zippable} data */
export async function zipOrUnzip(data) {
  const worker = new Worker(__.PUBLIC_LIB + '/zip-worker.js');
  worker.onerror = worker.onmessageerror = e => rejectPending(`${e}`);
  worker.onmessage = onClientMessage.bind(null, noop);
  try {
    return await sendCmdTo('', data, worker, null, NO_PROXY);
  } finally {
    worker.terminate();
  }
}

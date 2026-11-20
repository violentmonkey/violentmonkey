import { readBlob } from '.';
import { onClientMessage } from './messaging-sw';
import { kOptionsJson, kStorageJson, kUserJs, vmZipEntryName } from './zip';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate/browser';

global.onmessage = onClientMessage.bind(null, async ({ data }) => {
  if (data instanceof Blob) {
    let vm;
    const scriptTimes = new Map();
    const buf = await (__.MV3 ? data.arrayBuffer() : data.arrayBuffer?.() || readBlob(data, true));
    const files = unzipSync(new Uint8Array(buf), {
      filter: ({ name: filename, time, originalSize }) => originalSize < 100e6 && (
        filename.toLowerCase() === vmZipEntryName ? vm = filename :
        filename.endsWith(kOptionsJson) ||
        filename.endsWith(kStorageJson) ||
        filename.endsWith(kUserJs) && scriptTimes.set(filename, time)
      ),
    });
    for (const f in files) files[f] = strFromU8(files[f]);
    data = [vm, files, scriptTimes];
  } else {
    for (const val of Object.values(data)) val[0] = strToU8(val[0]);
    data = new Blob([zipSync(data)], { type: 'application/zip' });
  }
  return data;
});

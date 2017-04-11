/**
 * All functions to be injected into web page must be independent.
 * They must be assigned to `bridge` so that they can be serialized.
 */
import { noop, getUniqId, postData } from './utils';

function post(data) {
  const bridge = this;
  bridge.postData(bridge.destId, data);
}

function bindEvents(src, dest) {
  const bridge = this;
  const { vmid } = bridge;
  const srcId = vmid + src;
  bridge.destId = vmid + dest;
  document.addEventListener(srcId, e => {
    const data = JSON.parse(e.detail);
    bridge.handle(data);
  }, false);
}

// Array functions
// Notice: avoid using prototype functions since they may be changed by page scripts
function forEach(arr, func) {
  const length = arr && arr.length;
  for (let i = 0; i < length; i += 1) func(arr[i], i, arr);
}
function includes(arr, item) {
  const length = arr && arr.length;
  for (let i = 0; i < length; i += 1) {
    if (arr[i] === item) return true;
  }
  return false;
}
function map(arr, func) {
  const bridge = this;
  const res = [];
  bridge.forEach(arr, (item, i) => {
    res.push(func(item, i, arr));
  });
  return res;
}

export default {
  postData,
  post,
  getUniqId,
  forEach,
  includes,
  map,
  noop,
  bindEvents,
  vmid: `VM_${getUniqId()}`,
};

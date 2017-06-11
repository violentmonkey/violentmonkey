import { sendMessage } from '../utils';
import bridge from './bridge';

const requests = {};

export function getRequestId() {
  sendMessage({ cmd: 'GetRequestId' })
  .then(id => {
    requests[id] = 1;
    bridge.post({ cmd: 'GotRequestId', data: id });
  });
}
export function httpRequest(details) {
  sendMessage({ cmd: 'HttpRequest', data: details });
}
export function httpRequested(data) {
  if (requests[data.id]) {
    if (data.type === 'loadend') delete requests[data.id];
    bridge.post({ cmd: 'HttpRequested', data });
  }
}
export function abortRequest(id) {
  sendMessage({ cmd: 'AbortRequest', data: id });
}

import { sendMessage } from '../utils';
import bridge from './bridge';

const requests = {};

export function getRequestId(_, realm) {
  sendMessage({ cmd: 'GetRequestId' })
  .then((id) => {
    requests[id] = realm;
    bridge.post({ cmd: 'GotRequestId', data: id, realm });
  });
}
export function httpRequest(details) {
  sendMessage({ cmd: 'HttpRequest', data: details });
}
export function httpRequested(data) {
  const realm = requests[data.id];
  if (realm) {
    if (data.type === 'loadend') delete requests[data.id];
    bridge.post({ cmd: 'HttpRequested', data, realm });
  }
}
export function abortRequest(id) {
  sendMessage({ cmd: 'AbortRequest', data: id });
}

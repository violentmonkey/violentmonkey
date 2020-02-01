import { sendCmd, sendMessage } from '../utils';
import bridge from './bridge';

const requests = {};

bridge.addHandlers({
  async GetRequestId(eventsToNotify, realm) {
    const id = await sendCmd('GetRequestId', eventsToNotify);
    requests[id] = realm;
    bridge.post('GotRequestId', id, realm);
  },
  HttpRequest: sendMessage,
  AbortRequest: sendMessage,
});

bridge.addBackgroundHandlers({
  HttpRequested(msg) {
    const { id, numChunks } = msg;
    const realm = requests[id];
    if (realm) {
      bridge.post('HttpRequested', msg, realm);
      if (msg.isLastChunk || msg.type === 'loadend' && (!numChunks || numChunks === 1)) {
        delete requests[id];
      }
    }
  },
});

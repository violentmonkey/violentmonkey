import { sendCmd } from '../utils';
import bridge from './bridge';

const requests = {};

bridge.addHandlers({
  async GetRequestId(eventsToNotify, realm) {
    const id = await sendCmd('GetRequestId', eventsToNotify);
    requests[id] = { realm };
    return id;
  },
  HttpRequest: sendCmd,
  AbortRequest: sendCmd,
});

bridge.addBackgroundHandlers({
  HttpRequested(msg) {
    const { id, numChunks, type } = msg;
    const req = requests[id];
    if (req) {
      bridge.post('HttpRequested', msg, req.realm);
      // chunks may be sent in progress/load/loadend events
      if (type === 'loadend') {
        req.ended = true;
        req.allChunks = !numChunks || numChunks === 1;
      } else {
        req.allChunks = msg.isLastChunk;
      }
      if (req.ended && req.allChunks) delete requests[id];
    }
  },
});

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
    const { id, isLastChunk, numChunks, type } = msg;
    const req = requests[id];
    if (req) {
      bridge.post('HttpRequested', msg, req.realm);
      // chunks may be sent in progress/load/loadend events
      let { allChunks } = req;
      if (type === 'loadend') {
        req.ended = true;
        allChunks = allChunks || !numChunks || numChunks === 1;
      } else if (isLastChunk) {
        allChunks = true;
      }
      req.allChunks = allChunks;
      if (req.ended && allChunks) delete requests[id];
    }
  },
});

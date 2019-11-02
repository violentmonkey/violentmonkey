import { sendCmd, sendMessage } from '../utils';
import bridge from './bridge';

const requests = {};

bridge.addHandlers({
  GetRequestId(_, realm) {
    sendCmd('GetRequestId')
    .then((id) => {
      requests[id] = realm;
      bridge.post({ cmd: 'GotRequestId', data: id, realm });
    });
  },
  HttpRequest: sendMessage,
  AbortRequest: sendMessage,
});

bridge.addBackgroundHandlers({
  HttpRequested(data) {
    const realm = requests[data.id];
    if (realm) {
      if (data.type === 'loadend') delete requests[data.id];
      bridge.post({ cmd: 'HttpRequested', data, realm });
    }
  },
});

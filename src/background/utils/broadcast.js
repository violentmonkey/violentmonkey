import { makePause } from '@/common';
import { sendCmd } from '@/common/messaging';
import { broadcaster } from '@/common/messaging-sw';
import { incognitoAllowed, inIncognitoContext, init } from './init';

export default __.SW ? broadcastCmd : sendCmd;
export const S_MSG_IN = 'msg' + (inIncognitoContext ? '' : 'i');
export const S_MSG_OUT = 'msg' + (inIncognitoContext ? 'i' : '');
const ACK = true;
const apiSession = __.SW && chrome.storage.session;
let chain = __.SW && Promise.resolve();
let resolveAck;
let incomingLen = 0;
let incomingStr = '';

if (__.SW) init.then(() => incognitoAllowed &&
  apiSession.onChanged.addListener(changes => {
    let val;
    if ((val = changes[S_MSG_IN]) && (val = val.newValue) && val !== ACK) {
      if (val > 0) {
        incomingLen = val;
        incomingStr = '';
      } else if ((incomingStr += val) && (!incomingLen || incomingStr.length === incomingLen)) {
        broadcaster.postMessage(JSON.parse(incomingStr));
        incomingLen = 0;
        incomingStr = '';
      }
      send(S_MSG_IN, ACK);
    } else if ((val = changes[S_MSG_OUT]) && val.newValue === ACK) {
      resolveAck(val);
    }
  }));

function broadcastCmd(cmd, data) {
  data = { cmd, data };
  broadcaster.postMessage(data);
  if (incognitoAllowed) chain = chain.finally(() => broadcastToSplit(data));
}

async function broadcastToSplit(msg) {
  msg = JSON.stringify(msg);
  const len = msg.length;
  const step = len > 10e3 &&
    (apiSession.QUOTA_BYTES - await apiSession.getBytesInUse()) / 4;
  const big = step && step < len;
  if (await send(S_MSG_OUT, big ? len : msg) && big) {
    for (let i = 0; i < len && await send(S_MSG_OUT, msg.slice(i, i + step)); ) {
      i += step;
    }
  }
  await apiSession.remove(S_MSG_OUT);
  resolveAck = null;
}

async function send(key, val) {
  const p = Promise.withResolvers();
  resolveAck = p.resolve;
  await apiSession.set({ [key]: val });
  return Promise.race([p.promise, makePause(100)]);
}

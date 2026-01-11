const { chrome } = globalThis;

export const RPC_TYPE = 'VM3_RPC';
export const RPC_PORT_NAME = 'VM3_RPC';

const inflight = new Map();
let rpcPort;

export function isMv3UserScript() {
  return !!chrome?.runtime?.onUserScriptMessage || !!chrome?.runtime?.onUserScriptConnect;
}

function rejectPromise(err) {
  if (SafePromise?.reject) return SafePromise.reject(err);
  return new SafePromise((_, reject) => reject(err));
}

function handlePortMessage(message) {
  const requestId = message?.requestId;
  if (!requestId || !inflight.has(requestId)) return;
  const { resolve, reject } = inflight.get(requestId);
  inflight.delete(requestId);
  if (message.ok) resolve(message.result);
  else reject(new Error(message.error || 'RPC error'));
}

function handlePortDisconnect() {
  rpcPort = null;
}

function getPort() {
  if (rpcPort) return rpcPort;
  rpcPort = chrome.runtime.connect({ name: RPC_PORT_NAME });
  rpcPort.onMessage.addListener(handlePortMessage);
  rpcPort.onDisconnect.addListener(handlePortDisconnect);
  return rpcPort;
}

function sendMessageRpc(message) {
  return new SafePromise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const err = chrome.runtime.lastError;
      if (err) return reject(err);
      if (!response || response.requestId !== message.requestId) {
        return reject(new Error('Invalid RPC response'));
      }
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error || 'RPC error'));
    });
  });
}

export function vm3Rpc(method, params, script) {
  if (!chrome?.runtime) {
    return rejectPromise(new Error('Runtime API unavailable'));
  }
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const message = {
    type: RPC_TYPE,
    requestId,
    method,
    params,
    script,
  };
  if (chrome.runtime.connect) {
    try {
      const port = getPort();
      return new SafePromise((resolve, reject) => {
        inflight.set(requestId, { resolve, reject });
        port.postMessage(message);
      });
    } catch (error) {
      return sendMessageRpc(message);
    }
  }
  return sendMessageRpc(message);
}

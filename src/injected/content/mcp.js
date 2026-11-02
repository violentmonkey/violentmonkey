import * as bridge from './bridge';
import { sendCmd } from './util';

let token;
let ready;
let context;
let registered;
export const setMcpToken = response => {
  token = context = undefined;
  registered = createNullObj();
  ready = response::then(data => {
    token = data?.mcpToken;
    context = data?.mcpContext;
  }, () => {});
};

/** Called only for a trusted persisted pageshow, without rerunning userscript code. */
export function restoreMcp() {
  const previous = ready;
  ready = (async () => {
    await previous;
    if (!token || !context) return;
    token = undefined;
    try {
      const data = await sendCmd('McpRestoreDocument', {
        ...context, scriptIds: objectKeys(registered)::map(id => +id),
      });
      token = data.mcpToken;
    } catch {
      // Revoked grants and disconnected sessions require an explicit reload.
      context = undefined;
    }
  })();
  return ready;
}

async function authorize(data, realm) {
  await ready;
  if (!token || bridge.ids[data.id] !== realm) {
    throw new Error('MCP result channel unavailable; grant this tab and reload it');
  }
}

async function relay(cmd, data, realm) {
  await authorize(data, realm);
  return sendCmd(cmd, { ...data, token });
}

bridge.addHandlers({
  async RegisterMcpHandler(data, realm) {
    const result = await relay('RegisterMcpHandler', data, realm);
    registered[data.id] = true;
    return result;
  },
  ScriptResult: (data, realm) => relay('ScriptResult', data, realm),
});

bridge.addBackgroundHandlers({
  async McpCall(data) {
    await ready;
    const realm = bridge.ids[data.id];
    if (!token || data.token !== token || realm !== PAGE && realm !== CONTENT) return false;
    bridge.post('McpCall', { id: data.id, callId: data.callId, params: data.params }, realm);
    return true;
  },
}, true);

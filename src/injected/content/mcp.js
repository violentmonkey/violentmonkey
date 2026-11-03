import * as bridge from './bridge';
import { sendCmd } from './util';

/** @type {VMInjection['mcp']} */
let mcp;
let ready;
/** Handler metadata by script id and name, resent when restored from BFCache */
let registered;
export const setMcp = response => {
  registered = createNullObj();
  ready = response::then(data => {
    mcp = data?.mcp;
  });
};

/** Called only for a trusted persisted pageshow, without rerunning userscript code. */
export function restoreMcp() {
  const previous = ready;
  ready = (async () => {
    await previous;
    if (!mcp) return;
    const { sessionId, pageId } = mcp;
    mcp = null;
    try {
      const { token } = await sendCmd('McpRestoreDocument', {
        sessionId,
        pageId,
        scripts: objectKeys(registered)::map(id => {
          const own = registered[id];
          return {
            id: +id,
            handlers: objectKeys(own)::map(name => own[name]),
          };
        }),
      });
      mcp = { token, sessionId, pageId };
    } catch {
      // Revoked grants and disconnected sessions require an explicit reload.
    }
  })();
  return ready;
}

async function relay(cmd, data, realm) {
  await ready;
  if (!mcp || bridge.ids[data.id] !== realm) {
    throw new Error('MCP channel unavailable; grant this tab and reload it');
  }
  return sendCmd(cmd, { ...data, token: mcp.token });
}

bridge.addHandlers({
  async McpRegister(data, realm) {
    const res = await relay('McpRegister', data, realm);
    const own = registered[data.id] ||= createNullObj();
    data.handlers::forEach(h => { own[h.name] = h; });
    return res;
  },
  async McpUnregister(data, realm) {
    const res = await relay('McpUnregister', data, realm);
    const own = registered[data.id];
    if (own) {
      data.names::forEach(name => { delete own[name]; });
      if (!objectKeys(own).length) delete registered[data.id];
    }
    return res;
  },
  McpReport: (data, realm) => relay('McpReport', data, realm),
  McpReturn: (data, realm) => relay('McpReturn', data, realm),
});

bridge.addBackgroundHandlers({
  async McpCall({ id, token, args }) {
    await ready;
    // `ids` also marks scripts that didn't run here (ID_BAD_REALM, ID_INJECTING),
    // so only a real realm can receive the call.
    const realm = bridge.ids[id];
    if (!mcp || token !== mcp.token || realm !== PAGE && realm !== CONTENT) return false;
    bridge.post('McpCall', { id, args }, realm);
    return true;
  },
}, true);

import { ErrorCode, createClient, ToolCallError } from '@violentmonkey/mcp-client';
import browser from '@/common/browser';
import { extensionOptionsPage } from '@/common/safe-globals';
import {
  getScriptById, getScripts, parseScript, removeScripts, updateScriptInfo,
} from './db';
import { addOwnCommands } from './init';
import { aliveScripts, removedScripts } from './script';
import storage, { S_CODE } from './storage';

export const MCP_CONNECT_URL = 'https://violentmonkey.github.io/mcp_connect.html';
const HOST = '127.0.0.1';

/** @type {{ port: number, token: string } | null} */
let pending = null;
let client = null;
let status = 'idle';
let current = null;

addOwnCommands({
  McpGetState: () => ({
    status,
    pending: pending && { port: pending.port },
    port: current?.port,
  }),
  McpApprove() {
    if (!pending) return;
    connect(pending);
    pending = null;
  },
  McpReject() {
    pending = null;
  },
  McpDisconnect() {
    client?.close();
    client = current = null;
    status = 'idle';
  },
});

/** Called when the user navigates to the connect URL. */
export function requestMcpConnection(url) {
  const params = new URL(url).searchParams;
  const port = +params.get('port');
  const token = params.get('token');
  if (!(port > 0 && port < 65536) || !token) return false;
  pending = { port, token };
  return true;
}

export function openMcpAuthorization(tabId) {
  return browser.tabs.update(tabId, { url: `${extensionOptionsPage}#settings/mcp` });
}

function connect({ port, token }) {
  client?.close();
  current = { port };
  client = createClient({
    host: HOST,
    port,
    token,
    info: { name: 'Violentmonkey', version: __.VM_VER },
  });
  registerTools(client);
  client.on('status', s => { status = s; });
  client.connect();
}

function getAliveScript(id) {
  const script = getScriptById(id);
  if (!script || script.config.removed) {
    throw new ToolCallError(ErrorCode.NotFound, `Script ${id} not found`);
  }
  return script;
}

function toSummary({ props, meta, config }) {
  return {
    id: props.id,
    name: meta.name,
    namespace: meta.namespace || undefined,
    version: meta.version || undefined,
    enabled: !!config.enabled,
    matches: meta.match || [],
  };
}

function registerTools(c) {
  c.handle('scripts_list', ({ query }) => {
    const q = query?.toLocaleLowerCase();
    return {
      scripts: getScripts()
      .filter(s => !q || (s.custom.name || s.meta.name || '').toLocaleLowerCase().includes(q))
      .map(toSummary),
    };
  });

  c.handle('scripts_get', async ({ id }) => {
    const script = getAliveScript(id);
    return { script: { ...toSummary(script), code: await storage[S_CODE].getOne(id) } };
  });

  c.handle('scripts_write', async ({ code, id, enabled }) => {
    if (id) getAliveScript(id);
    let result;
    try {
      result = await parseScript({
        code,
        id,
        message: '',
        bumpDate: true,
        reloadTab: true,
        ...enabled != null && { config: { enabled: enabled ? 1 : 0 } },
      });
    } catch (e) {
      throw new ToolCallError(ErrorCode.InvalidParams, String(e?.message || e));
    }
    return {
      script: toSummary(getScriptById(result.where.id)),
      created: !!result.isNew,
    };
  });

  c.handle('scripts_set_enabled', async ({ id, enabled }) => {
    const script = getAliveScript(id);
    await updateScriptInfo(id, {
      config: { enabled: enabled ? 1 : 0 },
      props: { lastModified: Date.now() },
    });
    return { script: toSummary(script) };
  });

  c.handle('scripts_delete', async ({ id }) => {
    getAliveScript(id);
    await markRemoved(id);
    await removeScripts([id]);
    return { id };
  });
}

async function markRemoved(id) {
  await updateScriptInfo(id, { config: { removed: 1 }, props: { lastModified: Date.now() } });
  const i = aliveScripts.findIndex(s => s.props.id === id);
  if (i >= 0) removedScripts.push(...aliveScripts.splice(i, 1));
}

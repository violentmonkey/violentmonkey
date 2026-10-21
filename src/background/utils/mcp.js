import { ErrorCode, createClient, ToolCallError } from '@violentmonkey/mcp-client';
import browser from '@/common/browser';
import { i18n, sendTabCmd } from '@/common';
import { extensionOptionsPage } from '@/common/safe-globals';
import { getScriptRunAt } from '@/common/script';
import {
  getScriptById, getScripts, parseScript, removeScripts, updateScriptInfo,
} from './db';
import { addOwnCommands, addPublicCommands } from './init';
import { grantTab, hasGrant, listGrants, revokeTab } from './mcp-grants';
import {
  addLogs, clear as clearObserved, dropTab, getLogs, getScripts as getTabScripts, reserveLoad,
  setActive,
} from './mcp-observe';
import { aliveScripts, getDefaultCustom, parseMeta, removedScripts } from './script';
import storage, { S_CODE } from './storage';
import { getTabUrl, injectableRe, tabsOnRemoved } from './tabs';
import { testScriptDetailed } from './tester';

export const MCP_CONNECT_URL = 'https://violentmonkey.github.io/mcp_connect.html';
const HOST = '127.0.0.1';

/** @type {{ port: number, token: string } | null} */
let pending = null;
let client = null;
let status = 'idle';
let current = null;

/** Whether an agent may read this tab: the server is up and the user granted the tab */
const isObserving = tabId => status === 'open' && hasGrant(tabId);

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
    clearObserved();
  },
  /** Open tabs and whether the agent may act on them, for the settings page */
  async McpGetTabs() {
    const tabs = await browser.tabs.query({});
    return tabs
    .filter(tab => injectableRe.test(getTabUrl(tab)))
    .map(({ id, title, url }) => ({
      tabId: id,
      title: title || '',
      url: url || '',
      granted: hasGrant(id),
    }));
  },
  McpGrantTab(tabId) {
    grantTab(tabId);
    // The current document was served before the grant, so ask it to start capturing
    sendTabCmd(tabId, 'SetLogCapture', true);
  },
  McpRevokeTab(tabId) {
    revokeTab(tabId);
    dropTab(tabId);
    sendTabCmd(tabId, 'SetLogCapture', false);
  },
});

tabsOnRemoved.addListener((tabId) => {
  revokeTab(tabId);
  dropTab(tabId);
});

/** GM_log output, forwarded by content scripts of tabs the agent may read */
addPublicCommands({
  ScriptLog({ entries, dropped }, src) {
    const tabId = src?.tab?.id;
    if (tabId == null || !entries?.length && !dropped) return;
    if (!isObserving(tabId)) return;
    addLogs(tabId, entries, dropped);
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
  client.on('status', (s) => {
    status = s;
    // Observe pages from the moment a connection is attempted so a blip doesn't lose data
    setActive(s === 'open' || s === 'connecting');
    if (s === 'closed') clearObserved();
  });
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

  c.handle('tabs_list', async () => {
    const tabs = [];
    for (const tabId of listGrants()) {
      const tab = await getTab(tabId);
      if (tab) tabs.push({ tabId, url: getTabUrl(tab), title: tab.title || '' });
      else revokeTab(tabId); // the tab is gone, the grant died with it
    }
    return { tabs };
  });

  c.handle('tab_scripts', async ({ tabId }) => {
    const tab = await getGrantedTab(tabId);
    const { loadId, url, scripts } = getTabScripts(tabId);
    return { url: url || getTabUrl(tab), loadId, scripts: scripts.map(toTabScript) };
  });

  c.handle('tab_reload', async ({ tabId }) => {
    const tab = await getGrantedTab(tabId);
    // Reserve the id of the document this reload will create, before it exists
    const loadId = reserveLoad(tabId);
    await browser.tabs.reload(tabId);
    return { tabId, url: getTabUrl(tab), loadId };
  });

  c.handle('script_logs', ({ tabId, ...opts }) => {
    requireGrant(tabId);
    return getLogs(tabId, opts);
  });

  c.handle('scripts_test_match', ({ code, url }) => {
    try {
      new URL(url);
    } catch {
      throw new ToolCallError(ErrorCode.InvalidParams, `Invalid URL: ${url}`);
    }
    const meta = parseMeta(code);
    if (!meta) {
      throw new ToolCallError(ErrorCode.InvalidParams,
        `${i18n('msgInvalidScript')}\n${i18n('labelNoName')}`);
    }
    return testScriptDetailed(url, { meta, custom: getDefaultCustom() });
  });
}

/** @returns {Promise<chrome.tabs.Tab>} */
async function getTab(tabId) {
  return browser.tabs.get(tabId).catch(() => null);
}

function requireGrant(tabId) {
  if (!hasGrant(tabId)) {
    throw new ToolCallError(ErrorCode.Denied, `Tab ${tabId} is not granted to the agent`);
  }
}

async function getGrantedTab(tabId) {
  requireGrant(tabId);
  const tab = await getTab(tabId);
  if (!tab) throw new ToolCallError(ErrorCode.NotFound, `Tab ${tabId} not found`);
  return tab;
}

/** Fills in what the injection record doesn't know, e.g. for a script that ran unrecorded */
function toTabScript(record) {
  let { name, version, runAt } = record;
  if (!name || !runAt) {
    const script = getScriptById(record.id);
    name ||= script?.meta.name;
    version ||= script?.meta.version;
    runAt ||= script && getScriptRunAt(script);
  }
  const { id, frameId, error, codeHash } = record;
  return {
    id,
    name: name || '',
    version: version || undefined,
    runAt: runAt ? `document-${runAt}` : '',
    frameId,
    status: record.status,
    ...error && { error },
    ...codeHash && { codeHash },
  };
}

async function markRemoved(id) {
  await updateScriptInfo(id, { config: { removed: 1 }, props: { lastModified: Date.now() } });
  const i = aliveScripts.findIndex(s => s.props.id === id);
  if (i >= 0) removedScripts.push(...aliveScripts.splice(i, 1));
}

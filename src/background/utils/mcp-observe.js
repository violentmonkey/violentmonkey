/**
 * Per-tab observation state for the MCP development tools: which scripts a tab's
 * document received and what they logged. Memory only, dropped with the tab.
 */

import { __CODE } from '@/common/consts';

/** @typedef {'injected' | 'failed' | 'pending'} McpScriptStatus */

/**
 * @typedef {Object} McpScriptRecord
 * @property {number} id
 * @property {number} frameId
 * @property {string} name
 * @property {string} [version]
 * @property {string} runAt
 * @property {McpScriptStatus} status
 * @property {string} [error]
 * @property {string} [codeHash]
 */
/**
 * @typedef {Object} McpLogEntry
 * @property {number} seq
 * @property {number} time
 * @property {number} scriptId
 * @property {string} text
 * @property {boolean} [truncated]
 * @property {number} [count]
 */

export const LOG_ENTRIES_MAX = 1000;
const LOG_BYTES_MAX = 2e6;
export const LOG_ENTRY_MAX = 8192;
const LOG_LIMIT_DEFAULT = 200;
export const LOG_LIMIT_MAX = 500;
/** How long a `loadId` reserved by tab_reload stays valid for the next load */
const LOAD_ID_TTL = 15e3;
/** Rough per-entry overhead when accounting the buffer size */
const ENTRY_OVERHEAD = 64;
const ERR_BAD_REALM = 'Page realm is not injectable on this document, '
  + 'the script needs @inject-into page';

/** @type {Map<number, Object>} */
const states = new Map();
let active = false;
let loadSeq = 0;
const sessionId = Date.now().toString(36);

/** Whether code hashes and logs are collected, i.e. an agent may be watching */
export const isActive = () => active;
export const setActive = (val) => {
  active = !!val;
};

function newLoadId() {
  loadSeq += 1;
  return `${sessionId}-${loadSeq}`;
}

function getState(tabId) {
  let st = states.get(tabId);
  if (!st) {
    states.set(tabId, st = {
      loadId: null,
      url: null,
      pendingLoadId: null,
      pendingLoadAt: 0,
      /** @type {Map<number, Map<number, McpScriptRecord>>} frameId -> scriptId -> record */
      frames: new Map(),
      /** @type {McpLogEntry[]} */
      logs: [],
      logBytes: 0,
      seq: 0,
      dropped: 0,
    });
  }
  return st;
}

/** The load the tab is known to be on, assigned lazily if it predates the connection */
function ensureLoadId(st) {
  return st.loadId || (st.loadId = newLoadId());
}

/**
 * Reserve the id of the document that `tab_reload` is about to create.
 * @returns {string}
 */
export function reserveLoad(tabId) {
  const st = getState(tabId);
  if (!st.pendingLoadId) {
    st.pendingLoadId = newLoadId();
    st.pendingLoadAt = Date.now();
  }
  return st.pendingLoadId;
}

/**
 * A top-level document started loading in this tab.
 * @param {number} tabId
 * @param {string} [url] - the document's URL
 * @param {boolean} [capturing] - whether this document was injected with log capture on
 * @returns {string} the id of the new load
 */
export function startLoad(tabId, url, capturing) {
  const st = getState(tabId);
  const pending = st.pendingLoadId;
  st.loadId = pending && Date.now() - st.pendingLoadAt < LOAD_ID_TTL ? pending : newLoadId();
  st.url = url;
  st.capturing = !!capturing;
  st.pendingLoadId = null;
  st.frames.clear();
  st.logs.length = 0;
  st.logBytes = 0;
  st.dropped = 0;
  return st.loadId;
}

/**
 * Whether the tab's current document was injected with log capture on, i.e. whether it
 * was loaded after the grant. Shown in the dashboard so the user knows a reload is due.
 * @param {number} tabId
 */
export function isCapturing(tabId) {
  return !!states.get(tabId)?.capturing;
}

/**
 * @param {any[]} chunks
 * @returns {string} 32-bit FNV-1a in hex
 */
function hashChunks(chunks) {
  let h = 0x811c9dc5;
  for (const chunk of chunks) {
    if (typeof chunk !== 'string') continue;
    for (let i = 0, len = chunk.length; i < len; i += 1) {
      h ^= chunk.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** @param {VMInjection.Script} scr */
function hashSource(scr) {
  const chunks = scr[__CODE];
  return hashChunks(Array.isArray(chunks) ? chunks : [chunks || scr.code || '']);
}

/**
 * Record what a document received, i.e. what the extension is about to run.
 * @param {number} tabId
 * @param {number} frameId
 * @param {VMInjection.Script[]} scripts
 * @param {Object} [opts]
 * @param {boolean} [opts.reset] - the frame is a new document, drop its previous records
 */
export function recordScripts(tabId, frameId, scripts, { reset } = {}) {
  const st = scripts?.length && states.get(tabId);
  if (!st) return;
  let records = st.frames.get(frameId);
  if (!records || reset) st.frames.set(frameId, records = new Map());
  for (const /** @type {VMInjection.Script} */ scr of scripts) {
    const { id, meta } = scr;
    const failed = scr.code === ID_BAD_REALM;
    records.set(id, {
      id,
      frameId,
      name: `${meta.name || ''}`,
      version: meta.version ? `${meta.version}` : undefined,
      runAt: scr[RUN_AT] || '',
      status: failed ? 'failed' : 'pending',
      error: failed ? ERR_BAD_REALM : undefined,
      codeHash: active ? hashSource(scr) : undefined,
    });
  }
}

/**
 * Mark scripts as started, as reported by the content script.
 * @param {number} tabId
 * @param {number} frameId
 * @param {number[]} ids
 */
export function markRun(tabId, frameId, ids) {
  const st = ids?.length && states.get(tabId);
  if (!st) return;
  let records = st.frames.get(frameId);
  if (!records) st.frames.set(frameId, records = new Map());
  for (const id of ids) {
    const record = records.get(id);
    if (!record) {
      // Shouldn't happen, but a script that ran is worth reporting even if unrecorded
      records.set(id, { id, frameId, name: '', runAt: '', status: 'injected' });
    } else if (record.status === 'pending') {
      record.status = 'injected';
      delete record.error;
    }
  }
}

/**
 * Mark a script as failed to inject.
 * @param {number} tabId
 * @param {number} frameId
 * @param {number} id
 * @param {string} error
 */
export function markFailed(tabId, frameId, id, error) {
  const record = states.get(tabId)?.frames.get(frameId)?.get(id);
  if (record) {
    record.status = 'failed';
    record.error = error;
  }
}

/**
 * @param {number} tabId
 * @returns {{ loadId: string, url: string | null, scripts: McpScriptRecord[] }}
 */
export function getScripts(tabId) {
  const st = getState(tabId);
  const scripts = [];
  for (const records of st.frames.values()) {
    for (const record of records.values()) scripts.push({ ...record });
  }
  scripts.sort((a, b) => a.frameId - b.frameId || a.id - b.id);
  return { loadId: ensureLoadId(st), url: st.url, scripts };
}

/**
 * Append log entries, collapsing identical consecutive lines and keeping the caps.
 * @param {number} tabId
 * @param {{ scriptId: number, text: string, time?: number }[]} entries
 * @param {number} [dropped] - entries already dropped before they got here
 */
export function addLogs(tabId, entries, dropped) {
  const st = states.get(tabId);
  if (!st || !entries?.length && !dropped) return;
  st.dropped += dropped || 0;
  for (const entry of entries) {
    let text = `${entry.text}`;
    let truncated = false;
    // The page realm already caps at the same length, so `>=` is what marks its output
    if (text.length >= LOG_ENTRY_MAX) {
      text = text.slice(0, LOG_ENTRY_MAX);
      truncated = true;
    }
    const scriptId = +entry.scriptId;
    const last = st.logs[st.logs.length - 1];
    if (last && last.scriptId === scriptId && last.text === text) {
      last.count = (last.count || 1) + 1;
      continue;
    }
    const size = text.length * 2 + ENTRY_OVERHEAD;
    st.seq += 1;
    st.logs.push({
      seq: st.seq,
      time: +entry.time || Date.now(),
      scriptId,
      text,
      ...truncated && { truncated },
      size,
    });
    st.logBytes += size;
  }
  while (st.logs.length > LOG_ENTRIES_MAX || st.logBytes > LOG_BYTES_MAX) {
    st.logBytes -= st.logs.shift().size;
    st.dropped += 1;
  }
}

/**
 * @param {number} tabId
 * @param {Object} [opts]
 * @param {number} [opts.scriptId]
 * @param {number} [opts.afterSeq]
 * @param {string} [opts.sinceLoadId]
 * @param {number} [opts.limit]
 * @returns {{ entries: McpLogEntry[], nextSeq: number, dropped: number }}
 */
export function getLogs(tabId, { scriptId, afterSeq, sinceLoadId, limit } = {}) {
  const st = getState(tabId);
  const loadId = ensureLoadId(st);
  const dropped = st.dropped;
  st.dropped = 0;
  // A stale load id means the document is gone, so nothing it logged is readable anymore
  if (sinceLoadId && sinceLoadId !== loadId) {
    return { entries: [], nextSeq: st.seq, dropped };
  }
  const max = Math.min(limit > 0 ? limit : LOG_LIMIT_DEFAULT, LOG_LIMIT_MAX);
  const from = afterSeq > 0 ? afterSeq : 0;
  const entries = [];
  for (const entry of st.logs) {
    if (entry.seq <= from) continue;
    if (scriptId != null && entry.scriptId !== scriptId) continue;
    if (entries.length >= max) break;
    entries.push({
      seq: entry.seq,
      time: entry.time,
      scriptId: entry.scriptId,
      text: entry.text,
      ...entry.truncated && { truncated: true },
      ...entry.count && { count: entry.count },
    });
  }
  return {
    entries,
    nextSeq: entries.length ? entries[entries.length - 1].seq : st.seq,
    dropped,
  };
}

/** @param {number} tabId */
export function dropTab(tabId) {
  states.delete(tabId);
}

/** Forgets everything, e.g. on disconnect or in tests */
export function clear() {
  states.clear();
  active = false;
}

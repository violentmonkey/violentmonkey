import { MCP_ERROR_MAX, MCP_RESULT_MAX } from '@/common/consts';

export const CALL_TIMEOUT_MAX = 25000;
export const ENTRIES_MAX = 100;
export const HANDLERS_MAX = 32;
const PENDING_MAX = 32;
const BYTES_MAX = 2 * 1024 * 1024;
const DESCRIPTION_MAX = 1024;
const SCHEMA_MAX = 16 * 1024;
const NAME_RE = /^[\w.-]{1,64}$/;
const TTL = 5 * 60 * 1000;
const tabs = new Map();
let sequence = 0;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function state(tabId) {
  let tab = tabs.get(tabId);
  if (!tab) tabs.set(tabId, tab = {
    documents: new Map(), entries: new Map(), dropped: 0,
    sessionId: crypto.randomUUID(), pageId: crypto.randomUUID(),
  });
  prune(tab);
  return tab;
}

const isPending = entry => entry.result.status === 'pending';

function prune(tab) {
  const now = Date.now();
  let bytes = 0;
  for (const [key, entry] of tab.entries) {
    if (!isPending(entry) && now - entry.updatedAt > TTL) {
      tab.entries.delete(key);
      tab.dropped += 1;
    } else bytes += entry.size;
  }
  for (const [key, entry] of tab.entries) {
    if (tab.entries.size <= ENTRIES_MAX && bytes <= BYTES_MAX) break;
    if (isPending(entry)) continue;
    tab.entries.delete(key);
    bytes -= entry.size;
    tab.dropped += 1;
  }
}

function snapshot(value) {
  // Callers must not be able to mutate retained state.
  return JSON.parse(JSON.stringify(value));
}

const measure = entry => (JSON.stringify(entry.result).length + (entry.params?.length || 0)) * 2;

function finish(entry, status, payload = {}) {
  clearTimeout(entry.timer);
  entry.updatedAt = Date.now();
  delete entry.result.error;
  Object.assign(entry.result, payload, { status, finishedAt: entry.updatedAt, seq: ++sequence });
  entry.size = measure(entry);
  entry.resolve?.(snapshot(entry.result));
  entry.resolve = null;
  entry.promise = null;
}

function cancel(tab, frameId, reason) {
  for (const entry of tab.entries.values()) {
    if (frameId != null && entry.result.frameId !== frameId) continue;
    if (entry.result.status === 'pending' || entry.result.status === 'timed_out') {
      finish(entry, 'cancelled', { error: reason });
    }
  }
}

function newDocument(tab, frameId, scripts = new Map()) {
  const token = crypto.randomUUID();
  // documentId is the public identity shown to the agent; the token stays private.
  tab.documents.set(frameId, { token, id: crypto.randomUUID(), scripts });
  return token;
}

/**
 * The token is private to the content script and changes for every document.
 * sessionId and pageId let the content script restore it after BFCache.
 * @return {VMInjection['mcp']}
 */
export function startDocument(tabId, frameId) {
  const tab = state(tabId);
  cancel(tab, frameId === 0 ? null : frameId, 'Document navigated or reloaded');
  if (frameId === 0) {
    tab.documents.clear();
    tab.pageId = crypto.randomUUID();
  }
  const { sessionId, pageId } = tab;
  return { token: newDocument(tab, frameId), sessionId, pageId };
}

/** @return {{ name: string, description?: string, inputSchema?: Object }[]} */
function parseHandlers(list) {
  if (!Array.isArray(list) || !list.length || list.length > HANDLERS_MAX) {
    fail(400, `Register 1–${HANDLERS_MAX} MCP handlers at a time`);
  }
  return list.map(item => {
    const { name, description, schema } = item || {};
    if (typeof name !== 'string' || !NAME_RE.test(name)) {
      fail(400, 'MCP handler names must be 1–64 letters, digits, "_", "." or "-"');
    }
    if (description != null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
      fail(400, `Description of MCP handler "${name}" must be a string up to ${DESCRIPTION_MAX} characters`);
    }
    let inputSchema;
    if (schema != null) {
      if (typeof schema !== 'string' || schema.length > SCHEMA_MAX) {
        fail(400, `inputSchema of MCP handler "${name}" exceeds 16k characters`);
      }
      try { inputSchema = JSON.parse(schema); } catch { /* checked below */ }
      if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
        fail(400, `inputSchema of MCP handler "${name}" must be a JSON object`);
      }
    }
    return { name, description: description || undefined, inputSchema };
  });
}

function mergeHandlers(own, list) {
  const merged = new Map(own);
  for (const handler of parseHandlers(list)) merged.set(handler.name, handler);
  if (merged.size > HANDLERS_MAX) fail(400, `A script can register at most ${HANDLERS_MAX} MCP handlers`);
  return merged;
}

const isScriptId = id => Number.isSafeInteger(id) && id > 0;

/** BFCache preserves handlers in the page, but its old token must stay invalid. */
export function restoreDocument(tabId, frameId, { sessionId, pageId, scripts }) {
  const tab = tabs.get(tabId);
  if (!tab || tab.sessionId !== sessionId) fail(403, 'MCP authorization changed; reload the tab');
  if (typeof pageId !== 'string' || !pageId || pageId.length > 128
    || !Array.isArray(scripts) || scripts.some(s => !isScriptId(s?.id))) {
    fail(400, 'Invalid restored document');
  }
  const restored = new Map();
  for (const { id, handlers } of scripts) restored.set(id, mergeHandlers(null, handlers));
  // Child pageshow events may arrive before the top frame's. Switch pages once,
  // then restore each frame independently so the parent cannot erase its children.
  const changedPage = tab.pageId !== pageId;
  cancel(tab, changedPage ? null : frameId, 'Document restored from back/forward cache');
  if (changedPage) {
    tab.documents.clear();
    tab.pageId = pageId;
  }
  return newDocument(tab, frameId, restored);
}

function documentFor(tabId, frameId, token) {
  const doc = tabs.get(tabId)?.documents.get(frameId);
  if (!doc || doc.token !== token) fail(403, 'MCP channel belongs to a different document');
  return doc;
}

export function registerHandlers(tabId, frameId, token, scriptId, list) {
  const doc = documentFor(tabId, frameId, token);
  if (!isScriptId(scriptId)) fail(400, 'Invalid scriptId');
  doc.scripts.set(scriptId, mergeHandlers(doc.scripts.get(scriptId), list));
  return true;
}

export function unregisterHandlers(tabId, frameId, token, scriptId, names) {
  const doc = documentFor(tabId, frameId, token);
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) fail(400, 'Invalid handler names');
  const own = doc.scripts.get(scriptId);
  if (own) {
    for (const name of names) own.delete(name);
    if (!own.size) doc.scripts.delete(scriptId);
  }
  return true;
}

export function getHandlers(tabId) {
  const scripts = [];
  for (const [frameId, doc] of state(tabId).documents) {
    for (const [scriptId, handlers] of doc.scripts) {
      scripts.push({ scriptId, frameId, handlers: snapshot([...handlers.values()]) });
    }
  }
  return { scripts };
}

const callKey = callId => `c:${callId}`;

/** Creates a call before dispatch, so even a synchronous reply can find its waiter. */
export function beginCall(tabId, {
  scriptId, frameId = 0, handler, params = null, callId = crypto.randomUUID(), timeoutMs = 10000,
}) {
  if (!isScriptId(scriptId)
    || !Number.isSafeInteger(frameId) || frameId < 0
    || typeof handler !== 'string' || !handler
    || typeof callId !== 'string' || !callId.length || callId.length > 128
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CALL_TIMEOUT_MAX) {
    fail(400, 'Invalid call parameters (handler is required, timeoutMs must be 1–25000)');
  }
  let json;
  try { json = JSON.stringify(params); } catch { fail(400, 'params must be JSON serializable'); }
  if (json == null || json.length > MCP_RESULT_MAX) fail(400, 'params exceed the JSON size limit');
  const tab = state(tabId);
  const previous = tab.entries.get(callKey(callId));
  if (previous) {
    const { result } = previous;
    if (result.scriptId !== scriptId || result.frameId !== frameId || result.handler !== handler
      || previous.params !== json) fail(400, 'callId is already used by a different call');
    return {
      isNew: false,
      result: snapshot(result),
      promise: isPending(previous) ? previous.promise : Promise.resolve(snapshot(result)),
    };
  }
  const doc = tab.documents.get(frameId);
  if (!doc?.scripts.get(scriptId)?.has(handler)) {
    fail(404, `Script has no MCP handler "${handler}" in this frame; see script_handlers`);
  }
  if ([...tab.entries.values()].filter(isPending).length >= PENDING_MAX) {
    fail(400, 'Too many pending script calls');
  }
  // Reports kept from an evicted call with the same id would be misattributed.
  for (const [key, entry] of tab.entries) {
    if (entry.result.kind === 'report' && entry.result.callId === callId) {
      tab.entries.delete(key);
      tab.dropped += 1;
    }
  }
  const entry = {
    token: doc.token,
    params: json,
    updatedAt: Date.now(),
    result: {
      kind: 'call', callId, scriptId, frameId, handler, documentId: doc.id,
      status: 'pending', startedAt: Date.now(), seq: ++sequence,
    },
  };
  entry.size = measure(entry);
  entry.promise = new Promise(resolve => { entry.resolve = resolve; });
  entry.timer = setTimeout(() => {
    finish(entry, 'timed_out', { error: 'Script did not return before timeout; execution may still be running' });
    prune(tab);
  }, timeoutMs);
  tab.entries.set(callKey(callId), entry);
  prune(tab);
  return {
    isNew: true,
    result: snapshot(entry.result),
    promise: entry.promise,
    message: { id: scriptId, token: doc.token, args: { callId, handler, params: JSON.parse(json) } },
  };
}

export function failCall(tabId, callId, error) {
  const entry = tabs.get(tabId)?.entries.get(callKey(callId));
  if (entry && isPending(entry)) finish(entry, 'failed', { error: `${error}`.slice(0, MCP_ERROR_MAX) });
}

function parseResult({ id, json, error }) {
  if (!isScriptId(id)
    || error != null && (typeof error !== 'string' || error.length > MCP_ERROR_MAX)
    || typeof json !== 'string' || json.length > MCP_RESULT_MAX) fail(400, 'Invalid script result');
  let value;
  try { value = JSON.parse(json); } catch { fail(400, 'Result must be JSON'); }
  return error != null ? { error } : { value };
}

/** A call can only be answered by its own script, frame and document. */
function callFor(tab, scriptId, frameId, token, callId) {
  const entry = typeof callId === 'string' && tab.entries.get(callKey(callId));
  if (!entry || entry.result.scriptId !== scriptId || entry.result.frameId !== frameId
    || entry.token !== token) fail(404, 'No matching call in this document');
  return entry;
}

/** The handler's return value or thrown error settles the call, even after a timeout. */
export function settleCall(tabId, frameId, token, data) {
  documentFor(tabId, frameId, token);
  const payload = parseResult(data);
  const tab = state(tabId);
  const entry = callFor(tab, data.id, frameId, token, data.callId);
  if (!isPending(entry) && entry.result.status !== 'timed_out') return { accepted: false };
  finish(entry, payload.error != null ? 'failed' : 'completed', payload);
  prune(tab);
  return { accepted: true };
}

/** Explicit reports are separate entries, optionally attached to a retained call. */
export function addReport(tabId, frameId, token, data) {
  const doc = documentFor(tabId, frameId, token);
  const payload = parseResult(data);
  const tab = state(tabId);
  const { callId } = data;
  if (callId != null) {
    // Reporting keeps the call it belongs to from expiring.
    callFor(tab, data.id, frameId, token, callId).updatedAt = Date.now();
  }
  const now = Date.now();
  const result = {
    kind: 'report', scriptId: data.id, frameId, documentId: doc.id,
    ...callId != null && { callId },
    ...payload,
    reportedAt: now,
    seq: ++sequence,
  };
  const entry = { result, updatedAt: now };
  entry.size = measure(entry);
  tab.entries.set(`r:${result.seq}`, entry);
  prune(tab);
  return true;
}

export function getResults(tabId, { scriptId, callId, afterSeq = 0, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > ENTRIES_MAX
    || !Number.isSafeInteger(afterSeq) || afterSeq < 0) fail(400, 'Invalid results cursor or limit');
  const tab = state(tabId);
  const entries = [...tab.entries.values()]
  .map(e => e.result)
  .filter(r => (scriptId == null || r.scriptId === scriptId)
    && (callId == null || r.callId === callId) && r.seq > afterSeq)
  .sort((a, b) => a.seq - b.seq)
  .slice(0, limit)
  .map(snapshot);
  return { entries, nextSeq: entries.at(-1)?.seq ?? afterSeq, dropped: tab.dropped };
}

export function dropExecutionTab(tabId) {
  const tab = tabs.get(tabId);
  if (tab) cancel(tab, null, 'Tab closed, authorization revoked, or MCP disconnected');
  tabs.delete(tabId);
}

export function clearExecution() {
  for (const tabId of tabs.keys()) dropExecutionTab(tabId);
}

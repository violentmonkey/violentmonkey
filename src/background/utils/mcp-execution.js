import { MCP_RESULT_MAX } from '@/common/consts';

export const CALL_TIMEOUT_MAX = 25000;
export const CALLS_MAX = 100;
const PENDING_MAX = 32;
const BYTES_MAX = 2 * 1024 * 1024;
const TTL = 5 * 60 * 1000;
const tabs = new Map();
let sequence = 0;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function state(tabId) {
  let tab = tabs.get(tabId);
  if (!tab) tabs.set(tabId, tab = {
    documents: new Map(), calls: new Map(), dropped: 0,
    sessionId: crypto.randomUUID(), pageId: crypto.randomUUID(),
  });
  prune(tab);
  return tab;
}

function prune(tab) {
  const now = Date.now();
  let bytes = 0;
  for (const [id, entry] of tab.calls) {
    if (entry.result.status !== 'pending' && now - entry.updatedAt > TTL) {
      tab.calls.delete(id);
      tab.dropped += 1;
    } else bytes += entry.size;
  }
  for (const [id, entry] of tab.calls) {
    if (tab.calls.size <= CALLS_MAX && bytes <= BYTES_MAX) break;
    if (entry.result.status === 'pending') continue;
    tab.calls.delete(id);
    bytes -= entry.size;
    tab.dropped += 1;
  }
}

function snapshot(entry) {
  // Callers must not be able to mutate retained results.
  return JSON.parse(JSON.stringify(entry.result));
}

function finish(entry, status, payload = {}) {
  clearTimeout(entry.timer);
  entry.updatedAt = Date.now();
  Object.assign(entry.result, payload, { status, finishedAt: entry.updatedAt, seq: ++sequence });
  entry.size = (JSON.stringify(entry.result).length + (entry.params?.length || 0)) * 2;
  entry.resolve?.(snapshot(entry));
  entry.resolve = null;
  entry.promise = null;
}

function cancel(tab, frameId, reason) {
  for (const entry of tab.calls.values()) {
    if (frameId != null && entry.result.frameId !== frameId) continue;
    if (entry.result.status === 'pending' || entry.result.status === 'timed_out') {
      finish(entry, 'cancelled', { error: reason });
    }
  }
}

/** The token is private to the content script and changes for every document. */
export function startDocument(tabId, frameId) {
  const tab = state(tabId);
  cancel(tab, frameId === 0 ? null : frameId, 'Document navigated or reloaded');
  if (frameId === 0) {
    tab.documents.clear();
    tab.pageId = crypto.randomUUID();
  }
  const token = crypto.randomUUID();
  tab.documents.set(frameId, { token, scripts: new Set() });
  return token;
}

/** Kept in the content script only; revocation/disconnection invalidates the session. */
export function getDocumentContext(tabId) {
  const { sessionId, pageId } = state(tabId);
  return { sessionId, pageId };
}

/** BFCache preserves handlers in the page, but its old result token must stay invalid. */
export function restoreDocument(tabId, frameId, { sessionId, pageId, scriptIds }) {
  const tab = tabs.get(tabId);
  if (!tab || tab.sessionId !== sessionId) fail(403, 'MCP authorization changed; reload the tab');
  if (typeof pageId !== 'string' || !pageId || pageId.length > 128
    || !Array.isArray(scriptIds) || scriptIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    fail(400, 'Invalid restored document');
  }
  // Child pageshow events may arrive before the top frame's. Switch pages once,
  // then restore each frame independently so the parent cannot erase its children.
  const changedPage = tab.pageId !== pageId;
  cancel(tab, changedPage ? null : frameId, 'Document restored from back/forward cache');
  if (changedPage) {
    tab.documents.clear();
    tab.pageId = pageId;
  }
  const token = crypto.randomUUID();
  tab.documents.set(frameId, { token, scripts: new Set(scriptIds) });
  return token;
}

function documentFor(tabId, frameId, token) {
  const doc = tabs.get(tabId)?.documents.get(frameId);
  if (!doc || doc.token !== token) fail(403, 'Result channel belongs to a different document');
  return doc;
}

export function registerHandler(tabId, frameId, token, scriptId) {
  if (!Number.isSafeInteger(scriptId) || scriptId <= 0) fail(400, 'Invalid scriptId');
  documentFor(tabId, frameId, token).scripts.add(scriptId);
  return true;
}

export function getHandlers(tabId) {
  const handlers = [];
  for (const [frameId, doc] of state(tabId).documents) {
    for (const scriptId of doc.scripts) handlers.push({ scriptId, frameId });
  }
  return { handlers };
}

function newEntry(tab, result) {
  const entry = { result, size: 0, updatedAt: Date.now() };
  tab.calls.set(result.callId, entry);
  return entry;
}

/** Creates a call before dispatch, so even a synchronous reply can find its waiter. */
export function beginCall(tabId, {
  scriptId, frameId = 0, params = null, callId = crypto.randomUUID(), timeoutMs = 10000,
}) {
  if (!Number.isSafeInteger(scriptId) || scriptId <= 0
    || !Number.isSafeInteger(frameId) || frameId < 0
    || typeof callId !== 'string' || !callId.length || callId.length > 128
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CALL_TIMEOUT_MAX) {
    fail(400, 'Invalid call parameters (timeoutMs must be 1–25000)');
  }
  let json;
  try { json = JSON.stringify(params); } catch { fail(400, 'params must be JSON serializable'); }
  if (json == null || json.length > MCP_RESULT_MAX) fail(400, 'params exceed the JSON size limit');
  const tab = state(tabId);
  const previous = tab.calls.get(callId);
  if (previous) {
    if (previous.result.scriptId !== scriptId || previous.result.frameId !== frameId
      || previous.params !== json) fail(400, 'callId is already used by a different call');
    return {
      isNew: false,
      result: snapshot(previous),
      promise: previous.result.status === 'pending' ? previous.promise : Promise.resolve(snapshot(previous)),
    };
  }
  const doc = tab.documents.get(frameId);
  if (!doc?.scripts.has(scriptId)) fail(404, 'Script has no MCP handler in this frame; load it and register GM_registerMcpHandler');
  if ([...tab.calls.values()].filter(e => e.result.status === 'pending').length >= PENDING_MAX) {
    fail(400, 'Too many pending script calls');
  }
  const entry = newEntry(tab, {
    callId, scriptId, frameId, documentId: doc.token,
    status: 'pending', startedAt: Date.now(), seq: ++sequence,
  });
  entry.params = json;
  entry.size = json.length * 2;
  entry.promise = new Promise(resolve => { entry.resolve = resolve; });
  entry.timer = setTimeout(() => {
    finish(entry, 'timed_out', { error: 'Script did not return before timeout; execution may still be running' });
    prune(tab);
  }, timeoutMs);
  prune(tab);
  return {
    isNew: true,
    result: snapshot(entry),
    promise: entry.promise,
    message: { id: scriptId, callId, params: JSON.parse(json), token: doc.token },
  };
}

export function failCall(tabId, callId, error) {
  const entry = tabs.get(tabId)?.calls.get(callId);
  if (entry?.result.status === 'pending') finish(entry, 'failed', { error: `${error}`.slice(0, 8192) });
}

/** Explicit reports and callback returns use the same bounded, structured channel. */
export function reportResult(tabId, frameId, token, { id, callId, json, error }) {
  documentFor(tabId, frameId, token);
  if (!Number.isSafeInteger(id) || id <= 0
    || error != null && (typeof error !== 'string' || error.length > 8192)
    || typeof json !== 'string' || json.length > MCP_RESULT_MAX) fail(400, 'Invalid script result');
  let value;
  try { value = JSON.parse(json); } catch { fail(400, 'Result must be JSON'); }
  const tab = state(tabId);
  let entry;
  if (callId != null) {
    entry = tab.calls.get(callId);
    if (!entry || entry.result.scriptId !== id || entry.result.frameId !== frameId
      || entry.result.documentId !== token) fail(404, 'No matching call in this document');
    if (!['pending', 'timed_out'].includes(entry.result.status)) return { accepted: false, callId };
  } else {
    callId = crypto.randomUUID();
    entry = newEntry(tab, {
      callId, scriptId: id, frameId, documentId: token, startedAt: Date.now(),
    });
  }
  delete entry.result.error;
  finish(entry, error != null ? 'failed' : 'completed', error != null ? { error } : { value });
  prune(tab);
  return { accepted: true, callId };
}

export function getResults(tabId, { scriptId, callId, afterSeq = 0, limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > CALLS_MAX
    || !Number.isSafeInteger(afterSeq) || afterSeq < 0) fail(400, 'Invalid results cursor or limit');
  const tab = state(tabId);
  const entries = [...tab.calls.values()]
  .filter(e => (scriptId == null || e.result.scriptId === scriptId)
    && (callId == null || e.result.callId === callId) && e.result.seq > afterSeq)
  .sort((a, b) => a.result.seq - b.result.seq)
  .slice(0, limit).map(snapshot);
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

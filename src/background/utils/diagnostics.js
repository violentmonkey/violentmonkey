import * as acorn from 'acorn';
import { addOwnCommands, addPublicCommands, commands } from './init';
import { pushAlert } from './alerts';
import storage, { S_REQUIRE } from './storage';
import { getUserScriptsHealth } from './tabs';

const DIAGNOSTICS_STORAGE_KEY = 'diagnosticsLog';
const DIAGNOSTICS_SCHEMA_VERSION = 1;
const MV3_INSTALL_DNR_RULE_ID = 940001;
const DIAGNOSTICS_MAX_ENTRIES = 1500;
const DIAGNOSTICS_SAVE_DELAY = 1200;
const SCRIPT_ISSUE_DEDUP_TTL = 60e3;
const MAX_STRING_LENGTH = 400;
const MAX_ARRAY_ITEMS = 24;
const MAX_OBJECT_KEYS = 24;
const MAX_STACK_FRAMES = 5;
const SENSITIVE_KEY_RE = /(?:token|authorization|password|secret|cookie|api[_-]?key)/i;
const STACK_FRAME_CHROME_RE = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const STACK_FRAME_FIREFOX_RE = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;
const LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const IGNORED_COMMANDS = new Set([
  'DiagnosticsGetLog',
  'DiagnosticsExportLog',
  'DiagnosticsClearLog',
  'DiagnosticsLogScriptIssue',
  'HealthPing',
  'MainBridgePing',
]);
const SYNTAX_PARSE_OPTS = {
  allowHashBang: true,
  ecmaVersion: 'latest',
  sourceType: 'script',
};

const state = {
  dropped: 0,
  entries: [],
  nextId: 1,
  loaded: false,
  persistTimer: 0,
  persistQueue: Promise.resolve(),
  sessionId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  startedAt: Date.now(),
};
const recentScriptIssues = new Map();

const loadPromise = (async () => {
  try {
    const saved = await storage.base.getOne(DIAGNOSTICS_STORAGE_KEY);
    if (saved?.version === DIAGNOSTICS_SCHEMA_VERSION && Array.isArray(saved.entries)) {
      const pendingEntries = state.entries.slice();
      state.entries.length = 0;
      saved.entries.forEach(item => {
        const normalized = normalizeStoredEntry(item);
        if (normalized) state.entries.push(normalized);
      });
      pendingEntries.forEach(item => {
        const normalized = normalizeStoredEntry(item);
        if (normalized) state.entries.push(normalized);
      });
      state.nextId = Math.max(state.nextId, +saved.nextId || 1);
      state.dropped = +saved.dropped || 0;
      trimLog();
    }
  } catch (err) {
    if (process.env.DEBUG) console.warn('Failed to load diagnostics log:', err);
  } finally {
    state.loaded = true;
  }
})();

function normalizeStoredEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const ts = +entry.ts || Date.now();
  const level = normalizeLevel(entry.level);
  const event = `${entry.event || 'unknown'}`.slice(0, MAX_STRING_LENGTH);
  const type = `${entry.type || 'action'}`.slice(0, MAX_STRING_LENGTH);
  return {
    id: +entry.id || state.nextId++,
    ts,
    iso: entry.iso || new Date(ts).toISOString(),
    level,
    type,
    event,
    details: sanitizeValue(entry.details),
  };
}

function normalizeLevel(level) {
  return LEVEL_PRIORITY[level] >= 0 ? level : 'info';
}

function getLevelPriority(level) {
  return LEVEL_PRIORITY[normalizeLevel(level)];
}

function sanitizeError(error) {
  if (error instanceof Error) {
    return sanitizeValue({
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    });
  }
  return sanitizeValue(error);
}

function clipString(value) {
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}...`
    : value;
}

function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  const type = typeof value;
  if (type === 'boolean' || type === 'number') return value;
  if (type === 'string') return clipString(value);
  if (type === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (depth > 4) return '[MaxDepth]';
  if (type !== 'object') return `${value}`;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map(item => sanitizeValue(item, depth + 1, seen));
  }
  const obj = {};
  Object.keys(value).slice(0, MAX_OBJECT_KEYS).forEach(key => {
    obj[key] = SENSITIVE_KEY_RE.test(key)
      ? '[Redacted]'
      : sanitizeValue(value[key], depth + 1, seen);
  });
  return obj;
}

function compactObject(obj) {
  const out = {};
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (value != null && value !== '') out[key] = value;
  });
  return out;
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message || error.name || 'Error';
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    return `${error.message || error.name || 'Unknown error'}`;
  }
  return `${error || 'Unknown error'}`;
}

function getFrameFile(url = '') {
  const input = `${url}`.replace(/[()]/g, '');
  if (!input) return '';
  try {
    const parsed = new URL(input);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || parsed.hostname || input;
  } catch {
    const parts = input.split(/[\\/]/);
    return parts[parts.length - 1] || input;
  }
}

function parseStackFrames(stackText) {
  if (!stackText || typeof stackText !== 'string') return [];
  const frames = [];
  for (const line of stackText.split('\n')) {
    let match = line.match(STACK_FRAME_CHROME_RE);
    if (!match) match = line.match(STACK_FRAME_FIREFOX_RE);
    if (!match) continue;
    const [, functionName, url, lineNo, columnNo] = match;
    frames.push(compactObject({
      functionName: clipString(functionName || '<anonymous>'),
      url: clipString(url || ''),
      file: clipString(getFrameFile(url)),
      line: +lineNo || undefined,
      column: +columnNo || undefined,
    }));
    if (frames.length >= MAX_STACK_FRAMES) break;
  }
  return frames;
}

function inferErrorSource({ source, sender, topFrame }) {
  if (source) return source;
  const frameUrl = `${topFrame?.url || ''}`;
  if (/^(chrome|moz)-extension:/.test(frameUrl)) return 'background';
  const senderOrigin = `${sender?.origin || ''}`;
  if (/^(chrome|moz)-extension:/.test(senderOrigin)) return 'background';
  if (/^https?:/.test(senderOrigin)) return 'content';
  if (/^https?:/.test(frameUrl)) return 'page';
  return 'unknown';
}

function buildErrorLocation(error, details = {}, options = {}, preParsedFrames) {
  const sender = details?.sender;
  const frames = preParsedFrames || parseStackFrames(error?.stack || '');
  const topFrame = frames[0];
  const location = compactObject({
    source: inferErrorSource({ source: options.source, sender, topFrame }),
    phase: options.phase || details?.phase,
    file: topFrame?.file || details?.file,
    line: topFrame?.line || (+details?.line || undefined),
    column: topFrame?.column || (+details?.column || undefined),
    functionName: topFrame?.functionName,
    url: topFrame?.url || details?.url || sender?.url,
    scriptId: details?.scriptId,
    scriptName: details?.scriptName,
    runAt: details?.runAt,
    realm: details?.realm,
    command: details?.cmd,
  });
  return Object.keys(location).length ? sanitizeValue(location) : null;
}

function buildDiagnosticFingerprint({
  event,
  message,
  sender,
  cmd,
  scriptId,
  scriptName,
  runAt,
  realm,
  topFrame,
}) {
  const parts = [
    event,
    cmd,
    scriptId,
    scriptName,
    runAt,
    realm,
    message,
    topFrame?.file,
    topFrame?.line,
    topFrame?.column,
    sender?.url,
    sender?.tabId,
    sender?.frameId,
  ].filter(Boolean);
  return parts.length ? clipString(parts.join('|')) : '';
}

function toPositiveInt(value) {
  const num = +value;
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : 0;
}

function buildEditorRoute({ scriptId, line, column, source, requireUrl }) {
  const id = toPositiveInt(scriptId);
  if (!id) return '';
  const query = new URLSearchParams();
  if (line > 0 || column > 0) query.set('error', 'syntax');
  if (line > 0) query.set('line', `${line}`);
  if (column > 0) query.set('column', `${column}`);
  if (source) query.set('source', `${source}`.slice(0, 24));
  if (requireUrl) query.set('requireUrl', clipString(`${requireUrl}`));
  const queryString = query.toString();
  return queryString ? `scripts/${id}?${queryString}` : `scripts/${id}`;
}

function probeSyntaxFromCode(code, { scriptId, source, requireUrl } = {}) {
  try {
    acorn.parse(code, SYNTAX_PARSE_OPTS);
    return {
      ok: true,
      scriptId: toPositiveInt(scriptId),
      source,
      requireUrl,
      message: '',
    };
  } catch (error) {
    const line = toPositiveInt(error?.loc?.line);
    const column = toPositiveInt((error?.loc?.column ?? -1) + 1);
    return sanitizeValue({
      ok: false,
      scriptId: toPositiveInt(scriptId),
      source,
      requireUrl,
      line: line || undefined,
      column: column || undefined,
      message: getErrorMessage(error),
      stack: error?.stack ? clipString(`${error.stack}`) : '',
    });
  }
}

async function resolveScriptSyntaxIssue(payload) {
  const {
    scriptId,
    runAt,
    realm,
  } = payload || {};
  const id = toPositiveInt(scriptId);
  if (!id) {
    return { ok: false, message: 'Missing script id.', source: 'unknown' };
  }
  if (!commands.GetScript || !commands.GetScriptCode) {
    return { ok: false, message: 'Script lookup unavailable.', source: 'unknown' };
  }
  const script = commands.GetScript({ id });
  if (!script) {
    return { ok: false, message: `Script #${id} not found.`, source: 'unknown', scriptId: id };
  }
  const scriptName = script?.custom?.name || script?.meta?.name || '';
  const code = await commands.GetScriptCode(id);
  if (typeof code !== 'string' || !code.length) {
    return {
      ok: false,
      scriptId: id,
      scriptName,
      source: 'main',
      runAt,
      realm,
      message: 'Script source is empty or unavailable.',
      editorRoute: buildEditorRoute({ scriptId: id }),
    };
  }
  let probe = probeSyntaxFromCode(code, {
    scriptId: id,
    source: 'main',
  });
  if (!probe.ok) {
    return {
      ...probe,
      scriptName,
      runAt,
      realm,
      editorRoute: buildEditorRoute({
        scriptId: id,
        line: probe.line,
        column: probe.column,
        source: probe.source,
      }),
    };
  }
  const requires = script?.meta?.require || [];
  const pathMap = script?.custom?.pathMap || {};
  for (const reqUrl of requires) {
    const resolvedUrl = pathMap[reqUrl] || reqUrl;
    const reqCode = resolvedUrl && await storage[S_REQUIRE].getOne(resolvedUrl);
    if (typeof reqCode !== 'string' || !reqCode.length) continue;
    probe = probeSyntaxFromCode(reqCode, {
      scriptId: id,
      source: 'require',
      requireUrl: resolvedUrl,
    });
    if (!probe.ok) {
      return {
        ...probe,
        scriptName,
        runAt,
        realm,
        editorRoute: buildEditorRoute({
          scriptId: id,
          line: probe.line,
          column: probe.column,
          source: probe.source,
          requireUrl: probe.requireUrl,
        }),
      };
    }
  }
  return {
    ok: true,
    scriptId: id,
    scriptName,
    source: 'main',
    runAt,
    realm,
    message: 'No syntax errors detected by parser.',
    editorRoute: buildEditorRoute({ scriptId: id }),
  };
}

function summarizeData(data) {
  if (data == null) return { type: `${data}` };
  if (typeof data === 'string') {
    return {
      type: 'string',
      length: data.length,
      preview: clipString(data),
    };
  }
  if (Array.isArray(data)) {
    return { type: 'array', length: data.length };
  }
  if (typeof data === 'object') {
    const keys = Object.keys(data);
    return {
      type: 'object',
      keyCount: keys.length,
      keys: keys.slice(0, MAX_OBJECT_KEYS),
    };
  }
  return {
    type: typeof data,
    value: sanitizeValue(data),
  };
}

function summarizeSender(src) {
  if (!src) return null;
  return sanitizeValue({
    fake: !!src.fake,
    origin: src.origin,
    url: src.url,
    tabId: src.tab?.id,
    frameId: src[kFrameId],
    documentId: src[kDocumentId],
    [kTop]: src[kTop],
  });
}

function trimLog() {
  const overflow = state.entries.length - DIAGNOSTICS_MAX_ENTRIES;
  if (overflow > 0) {
    state.entries.splice(0, overflow);
    state.dropped += overflow;
  }
}

function queuePersist() {
  state.persistQueue = state.persistQueue
    .then(async () => {
      await loadPromise;
      await storage.base.setOne(DIAGNOSTICS_STORAGE_KEY, {
        version: DIAGNOSTICS_SCHEMA_VERSION,
        dropped: state.dropped,
        nextId: state.nextId,
        entries: state.entries,
      });
    })
    .catch(err => {
      if (process.env.DEBUG) console.warn('Failed to persist diagnostics log:', err);
    });
  return state.persistQueue;
}

function schedulePersist(forceNow) {
  if (forceNow) {
    clearTimeout(state.persistTimer);
    state.persistTimer = 0;
    return queuePersist();
  }
  if (state.persistTimer) return state.persistQueue;
  state.persistTimer = setTimeout(() => {
    state.persistTimer = 0;
    queuePersist();
  }, DIAGNOSTICS_SAVE_DELAY);
  state.persistTimer.unref?.();
  return state.persistQueue;
}

function createEntry(type, level, event, details) {
  const ts = Date.now();
  return {
    id: state.nextId++,
    ts,
    iso: new Date(ts).toISOString(),
    level: normalizeLevel(level),
    type,
    event: clipString(`${event}`),
    details: sanitizeValue(details),
  };
}

function appendEntry(entry, forcePersist) {
  state.entries.push(entry);
  trimLog();
  schedulePersist(forcePersist || entry.level === 'error');
}

function getDuration(startedAt) {
  if (!Number.isFinite(startedAt)) return undefined;
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

function getStats(entries) {
  const byEvent = {};
  const byLevel = {};
  const byType = {};
  entries.forEach(({ event, level, type }) => {
    byEvent[event] = (byEvent[event] || 0) + 1;
    byLevel[level] = (byLevel[level] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
  });
  return {
    byEvent,
    byLevel,
    byType,
    total: entries.length,
  };
}

function getExtensionBuildInfo() {
  return {
    manifestVersion: extensionManifest.manifest_version,
    name: extensionManifest.name,
    version: process.env.VM_VER,
    buildId: process.env.VM_BUILD_ID || '',
  };
}

function getMeta(entryCount = state.entries.length) {
  return {
    dropped: state.dropped,
    entryCount,
    sessionId: state.sessionId,
    sessionStartedAt: new Date(state.startedAt).toISOString(),
    schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
    extension: getExtensionBuildInfo(),
  };
}

function getEntryTags(entry) {
  const tags = [];
  const event = `${entry?.event || ''}`;
  if (event.startsWith('command.')) tags.push('command');
  if (event.startsWith('userscript.')) tags.push('userscript');
  if (event.startsWith('runtime.')) tags.push('runtime');
  if (entry?.type === 'error') tags.push('error');
  const source = entry?.details?.errorLocation?.source;
  if (source) tags.push(`source:${source}`);
  return tags;
}

async function getFilteredEntries(payload) {
  const {
    event,
    level = 'debug',
    limit,
    since,
    type,
  } = payload || {};
  await loadPromise;
  const minLevel = getLevelPriority(level);
  const sinceTs = since == null
    ? 0
    : Number.isFinite(since)
      ? +since
      : Date.parse(since) || 0;
  let entries = state.entries.filter(item => (
    item.ts >= sinceTs
    && getLevelPriority(item.level) >= minLevel
    && (!event || item.event === event)
    && (!type || item.type === type)
  ));
  const max = +limit || 0;
  if (max > 0 && entries.length > max) entries = entries.slice(-max);
  return entries;
}

function formatTimestampForFile(ts) {
  return new Date(ts).toISOString().replace(/[.:]/g, '-');
}

async function getMv3RuntimeHealth(payload) {
  const { force } = payload || {};
  const isMv3 = extensionManifest.manifest_version === 3;
  if (!isMv3) {
    return {
      checkedAt: new Date().toISOString(),
      manifestVersion: extensionManifest.manifest_version,
      status: 'not-mv3',
    };
  }
  const userscripts = await getUserScriptsHealth(force !== false);
  const capabilities = {
    offscreenCreateDocument: !!chrome.offscreen?.createDocument,
    runtimeGetContexts: !!chrome.runtime?.getContexts,
    dnrGetSessionRules: !!chrome.declarativeNetRequest?.getSessionRules,
    dnrUpdateSessionRules: !!chrome.declarativeNetRequest?.updateSessionRules,
    userScriptsExecute: !!(chrome.userScripts || browser.userScripts)?.execute,
    userScriptsRegister: !!(chrome.userScripts || browser.userScripts)?.register,
  };
  let dnr = {
    hasInstallInterceptRule: false,
    sessionRuleCount: null,
    error: '',
  };
  if (chrome.declarativeNetRequest?.getSessionRules) {
    try {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      dnr = {
        hasInstallInterceptRule: !!rules?.some(rule => rule?.id === MV3_INSTALL_DNR_RULE_ID),
        sessionRuleCount: rules?.length || 0,
        error: '',
      };
    } catch (e) {
      dnr.error = `${e?.message || e || ''}`;
    }
  }
  let offscreen = {
    contextCount: null,
    error: '',
  };
  if (chrome.runtime?.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen/index.html')],
      });
      offscreen.contextCount = contexts?.length || 0;
    } catch (e) {
      offscreen.error = `${e?.message || e || ''}`;
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    extension: getExtensionBuildInfo(),
    manifestVersion: extensionManifest.manifest_version,
    minimumChromeVersion: extensionManifest.minimum_chrome_version || '',
    userscripts,
    capabilities,
    dnr,
    offscreen,
  };
}

export function logBackgroundAction(event, details, level = 'info') {
  appendEntry(createEntry('action', level, event, details));
}

export function logBackgroundError(event, error, details, options = {}) {
  const { alert = true } = options || {};
  const message = getErrorMessage(error);
  const sender = details?.sender;
  const frames = parseStackFrames(error?.stack || '');
  const topFrame = frames[0];
  const alertMessage = `${event}: ${message}`;
  const errorDetails = sanitizeError(error) || {};
  if (frames.length) {
    errorDetails.topFrame = sanitizeValue(topFrame);
    errorDetails.frames = sanitizeValue(frames);
  }
  const errorLocation = buildErrorLocation(error, details, options, frames);
  const fingerprint = details?.fingerprint || buildDiagnosticFingerprint({
    event,
    message,
    sender,
    cmd: details?.cmd,
    scriptId: details?.scriptId,
    scriptName: details?.scriptName,
    runAt: details?.runAt,
    realm: details?.realm,
    topFrame,
  });
  appendEntry(createEntry('error', 'error', event, {
    ...details,
    ...(fingerprint ? { fingerprint } : null),
    ...(errorLocation ? { errorLocation } : null),
    error: errorDetails,
  }), true);
  if (alert) {
    void pushAlert({
      code: `bg.${event}`,
      severity: 'error',
      message: alertMessage,
      details: sanitizeValue(details),
      fingerprint: `bg.${event}:${alertMessage}`,
    });
  }
}

export function logCommandReceived({ cmd, data, mode, src }) {
  if (!cmd || IGNORED_COMMANDS.has(cmd)) return;
  logBackgroundAction('command.received', {
    cmd,
    mode,
    sender: summarizeSender(src),
    data: summarizeData(data),
  });
}

export function logCommandSucceeded({ cmd, startedAt }) {
  if (!cmd || IGNORED_COMMANDS.has(cmd)) return;
  logBackgroundAction('command.succeeded', {
    cmd,
    durationMs: getDuration(startedAt),
  });
}

export function logCommandFailed({ cmd, error, startedAt, src }) {
  if (!cmd || IGNORED_COMMANDS.has(cmd)) return;
  const sender = summarizeSender(src);
  const fingerprint = buildDiagnosticFingerprint({
    event: 'command.failed',
    message: getErrorMessage(error),
    sender,
    cmd,
    topFrame: parseStackFrames(error?.stack || '')[0],
  });
  logBackgroundError('command.failed', error, {
    cmd,
    durationMs: getDuration(startedAt),
    sender,
    phase: 'execute',
    ...(fingerprint ? { fingerprint } : null),
  }, {
    source: 'background',
    phase: 'execute',
  });
}

function getScriptIssueFingerprint(payload, src) {
  if (payload?.fingerprint) {
    return clipString(`${payload.fingerprint}`);
  }
  const sender = summarizeSender(src);
  return clipString([
    payload?.scriptId,
    payload?.scriptName,
    payload?.runAt,
    payload?.reason,
    payload?.realm,
    sender?.tabId,
    sender?.frameId,
    sender?.url,
  ].filter(Boolean).join('|'));
}

function isDuplicateScriptIssue(fingerprint, source = 'unknown') {
  if (!fingerprint) return false;
  const now = Date.now();
  const prev = recentScriptIssues.get(fingerprint);
  if (prev && now - (prev?.ts || 0) < SCRIPT_ISSUE_DEDUP_TTL) {
    // Prefer richer signals over popup fallback when both report the same stall.
    if (prev?.source === 'popup' && source !== 'popup') {
      recentScriptIssues.set(fingerprint, { ts: now, source });
      return false;
    }
    return true;
  }
  recentScriptIssues.set(fingerprint, { ts: now, source });
  if (recentScriptIssues.size > 500) {
    for (const [key, info] of recentScriptIssues) {
      if (now - (info?.ts || 0) >= SCRIPT_ISSUE_DEDUP_TTL) recentScriptIssues.delete(key);
    }
  }
  return false;
}

addPublicCommands({
  async DiagnosticsLogScriptIssue(payload, src) {
    const issue = sanitizeValue(payload) || {};
    const sender = summarizeSender(src);
    const isExtensionSender = !!(sender?.origin && /^(?:chrome|moz|edge)-extension:\/\//.test(sender.origin));
    const source = isExtensionSender
      ? 'popup'
      : issue.realm === 'page' ? 'page' : 'content';
    if (extensionManifest.manifest_version === 3
    && source === 'popup'
    && issue.checkPhase === 'popup-state'
    && issue.state === ID_INJECTING) {
      return {
        logged: false,
        deduped: false,
        ignored: 'mv3-popup-injecting',
      };
    }
    const fingerprint = getScriptIssueFingerprint(issue, src);
    if (isDuplicateScriptIssue(fingerprint, source)) {
      return { logged: false, deduped: true };
    }
    const syntaxProbe = await resolveScriptSyntaxIssue({
      scriptId: issue.scriptId,
      runAt: issue.runAt,
      realm: issue.realm,
    });
    const hasSyntaxLocation = !!(syntaxProbe && !syntaxProbe.ok && (syntaxProbe.line || syntaxProbe.column));
    const classification = hasSyntaxLocation
      ? 'syntax-error'
      : syntaxProbe?.ok
        ? 'bootstrap-blocked'
        : 'startup-stalled';
    const event = classification === 'syntax-error'
      ? 'userscript.syntax.error'
      : classification === 'bootstrap-blocked'
        ? 'userscript.bootstrap.blocked'
        : 'userscript.startup.stalled';
    const reason = issue.reason || (
      classification === 'syntax-error'
        ? 'Script has a syntax error and could not execute.'
        : classification === 'bootstrap-blocked'
          ? 'Script passed syntax parsing but was blocked before bootstrap.'
          : 'Script stayed in injecting state and did not report a start signal.'
    );
    const syntaxSummary = syntaxProbe?.ok
      ? 'Syntax parse passed; startup likely blocked by CSP, realm, or injection constraints.'
      : '';
    logBackgroundError(event, reason, {
      ...issue,
      ...(syntaxProbe ? { syntaxProbe } : null),
      ...(classification ? { classification } : null),
      ...(syntaxSummary ? { syntaxSummary } : null),
      ...(syntaxProbe?.line ? {
        line: syntaxProbe.line,
        column: syntaxProbe.column,
        file: syntaxProbe.source === 'require' ? 'require' : 'userscript',
        url: syntaxProbe.requireUrl,
      } : null),
      sender,
      phase: 'bootstrap',
      fingerprint,
    }, {
      alert: false,
      source,
      phase: 'bootstrap',
    });
    return { logged: true, deduped: false };
  },
});

addOwnCommands({
  async DiagnosticsResolveScriptSyntax(payload) {
    return resolveScriptSyntaxIssue(payload);
  },
  async DiagnosticsGetLog(options) {
    const entries = await getFilteredEntries(options);
    return {
      meta: getMeta(entries.length),
      entries,
      stats: getStats(entries),
    };
  },
  async DiagnosticsExportLog(options) {
    const entries = await getFilteredEntries(options);
    const exportedAt = Date.now();
    const exportEntries = entries.map(entry => ({
      ...entry,
      location: entry?.details?.errorLocation || null,
      fingerprint: entry?.details?.fingerprint || '',
      tags: getEntryTags(entry),
    }));
    const payload = {
      exportedAt: new Date(exportedAt).toISOString(),
      meta: getMeta(exportEntries.length),
      stats: getStats(entries),
      entries: exportEntries,
    };
    const content = JSON.stringify(payload, null, 2);
    return {
      content,
      entryCount: entries.length,
      fileName: `projectsaturn-diagnostics-${formatTimestampForFile(exportedAt)}.json`,
      mimeType: 'application/json',
    };
  },
  async DiagnosticsClearLog() {
    await loadPromise;
    const cleared = state.entries.length;
    state.entries.length = 0;
    state.dropped = 0;
    state.nextId = 1;
    await schedulePersist(true);
    return { cleared };
  },
  async DiagnosticsGetMv3Health(options) {
    return getMv3RuntimeHealth(options);
  },
});

browser.runtime.onInstalled?.addListener(details => {
  logBackgroundAction('runtime.installed', {
    previousVersion: details?.previousVersion,
    reason: details?.reason,
  });
});
browser.runtime.onStartup?.addListener(() => {
  logBackgroundAction('runtime.startup', {});
});
browser.runtime.onSuspend?.addListener(() => {
  logBackgroundAction('runtime.suspend', {});
  void schedulePersist(true);
});
globalThis.addEventListener?.('error', event => {
  logBackgroundError('runtime.error', event.error || event.message, {
    column: event.colno,
    file: event.filename,
    line: event.lineno,
    phase: 'global.error',
  }, {
    source: 'background',
    phase: 'global.error',
  });
});
globalThis.addEventListener?.('unhandledrejection', event => {
  logBackgroundError('runtime.unhandledrejection', event.reason, {
    phase: 'global.unhandledrejection',
  }, {
    source: 'background',
    phase: 'global.unhandledrejection',
  });
});

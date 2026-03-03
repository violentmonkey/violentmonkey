import { initHooks } from '@/common';
import { addOwnCommands } from './init';
import storage from './storage';

const ALERTS_STORAGE_KEY = 'alertsState';
const ALERTS_SCHEMA_VERSION = 1;
const ALERTS_MAX_ITEMS = 200;
const ALERTS_SAVE_DELAY = 600;
const ALERT_DEDUPE_WINDOW = 30e3;
const ALERT_LEVELS = {
  info: 0,
  warn: 1,
  error: 2,
  critical: 3,
};

const hooks = initHooks();
const state = {
  items: [],
  loaded: false,
  nextId: 1,
  persistTimer: 0,
  persistQueue: Promise.resolve(),
};

const loadPromise = (async () => {
  try {
    const saved = await storage.base.getOne(ALERTS_STORAGE_KEY);
    if (saved?.version === ALERTS_SCHEMA_VERSION && Array.isArray(saved.items)) {
      state.items = saved.items.map(normalizeAlert).filter(Boolean);
      state.nextId = Math.max(+saved.nextId || 1, ...state.items.map(item => item.id + 1));
      trimAlerts();
    }
  } catch (e) {
    if (process.env.DEBUG) console.warn('Failed to load alerts:', e);
  } finally {
    state.loaded = true;
    fire();
  }
})();

function normalizeLevel(level) {
  return ALERT_LEVELS[level] >= 0 ? level : 'error';
}

function normalizeAlert(item) {
  if (!item || typeof item !== 'object') return null;
  const createdAt = +item.createdAt || Date.now();
  const updatedAt = +item.updatedAt || createdAt;
  return {
    id: +item.id || state.nextId++,
    code: `${item.code || 'unknown'}`.slice(0, 160),
    severity: normalizeLevel(item.severity),
    message: `${item.message || 'Unknown alert'}`.slice(0, 500),
    details: item.details && typeof item.details === 'object' ? item.details : {},
    fingerprint: `${item.fingerprint || ''}`.slice(0, 300),
    createdAt,
    updatedAt,
    read: !!item.read,
    count: Math.max(1, +item.count || 1),
  };
}

function makeFingerprint(alert) {
  return alert.fingerprint || `${alert.code}:${alert.severity}:${alert.message}`;
}

function trimAlerts() {
  const overflow = state.items.length - ALERTS_MAX_ITEMS;
  if (overflow > 0) {
    state.items.splice(0, overflow);
  }
}

function queuePersist() {
  state.persistQueue = state.persistQueue
    .then(async () => {
      await loadPromise;
      await storage.base.setOne(ALERTS_STORAGE_KEY, {
        version: ALERTS_SCHEMA_VERSION,
        nextId: state.nextId,
        items: state.items,
      });
    })
    .catch(e => {
      if (process.env.DEBUG) console.warn('Failed to persist alerts:', e);
    });
  return state.persistQueue;
}

function schedulePersist(force) {
  if (force) {
    clearTimeout(state.persistTimer);
    state.persistTimer = 0;
    return queuePersist();
  }
  if (state.persistTimer) return state.persistQueue;
  state.persistTimer = setTimeout(() => {
    state.persistTimer = 0;
    queuePersist();
  }, ALERTS_SAVE_DELAY);
  state.persistTimer.unref?.();
  return state.persistQueue;
}

function getUnreadAlerts() {
  return state.items.filter(item => !item.read);
}

function fire() {
  hooks.fire(getAlertsBadgeState());
}

export const hookAlerts = hooks.hook;

export function getAlertsBadgeState() {
  const unread = getUnreadAlerts().filter(item => ALERT_LEVELS[item.severity] >= ALERT_LEVELS.warn);
  return {
    count: unread.length,
    show: unread.length > 0,
  };
}

export async function pushAlert(payload) {
  const {
    code,
    severity = 'error',
    message,
    details = {},
    fingerprint,
  } = payload || {};
  await loadPromise;
  const now = Date.now();
  const normalized = normalizeAlert({
    id: state.nextId++,
    code,
    severity,
    message,
    details,
    fingerprint,
    createdAt: now,
    updatedAt: now,
    read: false,
    count: 1,
  });
  const dedupeKey = makeFingerprint(normalized);
  const existing = state.items.find(item => !item.read && makeFingerprint(item) === dedupeKey);
  if (existing) {
    if (now - existing.updatedAt >= ALERT_DEDUPE_WINDOW) {
      existing.count += 1;
    }
    existing.updatedAt = now;
    existing.details = normalized.details;
    existing.message = normalized.message;
    existing.severity = normalized.severity;
    schedulePersist();
    fire();
    return existing;
  }
  state.items.push(normalized);
  trimAlerts();
  schedulePersist();
  fire();
  return normalized;
}

export async function getAlertsSnapshot(payload) {
  const {
    unreadOnly,
    severity = 'info',
    limit = 30,
  } = payload || {};
  await loadPromise;
  const minLevel = ALERT_LEVELS[normalizeLevel(severity)];
  let items = state.items.filter(item => (
    ALERT_LEVELS[item.severity] >= minLevel
    && (!unreadOnly || !item.read)
  ));
  items = items.sort((a, b) => b.updatedAt - a.updatedAt);
  if (limit > 0) items = items.slice(0, limit);
  return {
    items,
    unreadCount: getUnreadAlerts().length,
    totalCount: state.items.length,
    badge: getAlertsBadgeState(),
  };
}

export async function markAlertsRead(payload) {
  const { id, all } = payload || {};
  await loadPromise;
  let updated = 0;
  state.items.forEach(item => {
    if (!item.read && (all || item.id === id)) {
      item.read = true;
      item.updatedAt = Date.now();
      updated += 1;
    }
  });
  if (updated) {
    await schedulePersist(true);
    fire();
  }
  return { updated };
}

export async function clearAlerts(payload) {
  const { all, readOnly } = payload || {};
  await loadPromise;
  const before = state.items.length;
  state.items = state.items.filter(item => (
    !all && !(readOnly && item.read)
  ));
  const removed = before - state.items.length;
  if (removed) {
    await schedulePersist(true);
    fire();
  }
  return { removed };
}

addOwnCommands({
  AlertsGet(data) {
    return getAlertsSnapshot(data);
  },
  AlertsMarkRead(data) {
    return markAlertsRead(data);
  },
  AlertsClear(data) {
    return clearAlerts(data);
  },
});

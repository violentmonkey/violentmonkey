import { getEventEmitter } from '../utils';

export const SYNC_IDLE = 1;
export const SYNC_UNAUTHORIZED = 2;
export const SYNC_AUTHORIZING = 3;
export const SYNC_AUTHORIZED = 4;
export const SYNC_INITIALIZING = 5;
export const SYNC_IN_PROGRESS = 6;
export const SYNC_ERROR_INIT = 7;
export const SYNC_ERROR_AUTH = 8;
export const SYNC_ERROR = 9;

const stateMap = {
  [SYNC_IDLE]: [SYNC_INITIALIZING, SYNC_UNAUTHORIZED],
  [SYNC_INITIALIZING]: [SYNC_AUTHORIZED, SYNC_ERROR_INIT, SYNC_UNAUTHORIZED],
  [SYNC_UNAUTHORIZED]: [SYNC_AUTHORIZING],
  [SYNC_AUTHORIZING]: [SYNC_ERROR_AUTH, SYNC_AUTHORIZED, SYNC_UNAUTHORIZED],
  [SYNC_AUTHORIZED]: [SYNC_UNAUTHORIZED, SYNC_INITIALIZING, SYNC_IN_PROGRESS],
  [SYNC_IN_PROGRESS]: [SYNC_AUTHORIZED, SYNC_ERROR],
  [SYNC_ERROR]: [SYNC_UNAUTHORIZED, SYNC_AUTHORIZING, SYNC_INITIALIZING],
  [SYNC_ERROR_INIT]: [SYNC_UNAUTHORIZED, SYNC_AUTHORIZING, SYNC_INITIALIZING],
  [SYNC_ERROR_AUTH]: [SYNC_UNAUTHORIZED, SYNC_AUTHORIZING],
};

export const events = getEventEmitter();

let state = defaultSyncState();

function defaultSyncState() {
  return {
    status: SYNC_IDLE,
  };
}

function onUpdated() {
  events.fire('change', state);
}

export function resetSyncState() {
  state = defaultSyncState();
  onUpdated();
}

export function getSyncState() {
  return state;
}

export function setSyncState(update) {
  if (update.status && !stateMap[state.status].includes(update.status)) {
    throw new Error(`Cannot move from ${state.status} to ${update.status}`);
  }
  state = { ...state, ...update };
  onUpdated();
}

/**
 * Collects what userscripts log with GM_log and hands it to the background, but only
 * for documents the background asked about, i.e. a tab the user granted to an agent.
 * The buffer is capped so a runaway logging loop can't flood the messaging channel.
 */

import * as bridge from './bridge';
import { sendCmd } from './util';

const FLUSH_MS = 250;
const BATCH_MAX = 100;
const BATCH_BYTES_MAX = 32e3;

let enabled;
let entries = [];
let bytes;
let dropped;
let timer;

/** @param {boolean} [val] */
export function setLogCapture(val) {
  val = !!val;
  if (enabled === val) return; // don't throw away what's already buffered
  enabled = val;
  entries = [];
  bytes = dropped = 0;
  clearTimeout(timer);
  timer = null;
}

function flush() {
  timer = null;
  if (!entries.length) return;
  const data = { entries, dropped };
  entries = [];
  bytes = dropped = 0;
  sendCmd('ScriptLog', data).catch(() => {});
}

function pushLog(scriptId, text) {
  if (!enabled) return;
  if (entries.length >= BATCH_MAX || bytes >= BATCH_BYTES_MAX) {
    dropped += 1;
    return;
  }
  entries[entries.length] = { scriptId, text, time: Date.now() };
  bytes += text.length * 2;
  timer ||= setTimeout(flush, FLUSH_MS);
}

bridge.addHandlers({
  ScriptLog: ({ id, text }) => pushLog(id, text),
});

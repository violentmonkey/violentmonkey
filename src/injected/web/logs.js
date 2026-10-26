/**
 * GM_log output for the agent, serialized here in the page realm because the arguments
 * may not cross the bridge and must not be allowed to exhaust the agent's context.
 *
 * Runs in both realms: the page sandbox and, for `@inject-into content`, inside the
 * content script's own realm (`VMInitInjection` in `index.js`). Only realm-neutral
 * globals may be used here.
 */

import * as bridge from './bridge';

/** Must match the background's per-entry cap */
const MAX_LEN = 8192;

/** Set by the host: serializing is pointless unless a granted tab is being observed */
let capture;

/** @param {boolean} val */
export function setLogCapture(val) {
  capture = !!val;
}

/** @param {GMContext} ctx */
export function reportLog(ctx, args) {
  const { post } = bridge;
  if (!capture || !post || !ctx || ctx.id == null) return;
  post('ScriptLog', { id: ctx.id, text: serialize(args) });
}

/**
 * A single argument is reported as-is (a string needs no quotes), several become a JSON
 * array. Never throws, so a script logging garbage still shows up as a placeholder
 * instead of a silently missing line.
 * @param {any[]} args
 */
function serialize(args) {
  const value = args.length === 1 ? args[0] : args;
  let text;
  try {
    text = typeof value === 'string' ? value : jsonStringify(value);
  } catch (e) { // circular structure, BigInt
    return placeholder(e?.message || `${e}`);
  }
  // JSON.stringify gives up silently on functions, symbols and undefined
  if (text == null) return placeholder(`${typeof value} cannot be represented in JSON`);
  // safe `slice`, not `text.slice`, so a patched String.prototype can't intercept it
  return text.length > MAX_LEN ? text::slice(0, MAX_LEN) : text;
}

/** @param {string} detail */
function placeholder(detail) {
  return `[unserializable: ${detail}]`;
}

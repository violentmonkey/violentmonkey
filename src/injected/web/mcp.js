import { MCP_RESULT_MAX } from '../util';
import * as bridge from './bridge';

const handlers = createNullObj();

function request(cmd, data) {
  return new SafePromise((resolve, reject) => {
    bridge.call(cmd, data, null, (res, err) => {
      if (err) reject(new SafeError(`${err.message || err}`));
      else resolve(res);
    });
  });
}

/** One callable entry point per script and frame. Returns an acknowledgement Promise. */
export async function registerMcpHandler(handler) {
  if (!isFunction(handler)) throw new SafeError('MCP handler must be a function');
  // Install before acknowledging so an immediate call cannot race registration.
  handlers[this.id] = handler;
  try {
    return await request('RegisterMcpHandler', { id: this.id });
  } catch (e) {
    if (handlers[this.id] === handler) delete handlers[this.id];
    throw e;
  }
}

/** @this {GMContext} */
export async function reportResult(value, options) {
  const opts = nullObjFrom(options);
  const error = opts.error == null ? undefined : `${opts.error}`::slice(0, 8192);
  const json = jsonStringify(value === undefined ? null : value);
  if (json == null) throw new SafeError('MCP result must be JSON serializable');
  if (json.length > MCP_RESULT_MAX) throw new SafeError('MCP result exceeds 256 Ki characters');
  return request('ScriptResult', { id: this.id, callId: opts.callId, json, error });
}

bridge.addHandlers({
  async McpCall({ id, callId, params }) {
    let value;
    let error;
    try {
      const handler = handlers[id];
      if (!handler) throw new SafeError('Script MCP handler is no longer registered');
      value = await handler(params, { __proto__: null, callId });
      await safeCall(reportResult, { id }, value, { callId });
      return;
    } catch (e) {
      try { error = `${e?.message || e}`; } catch { error = 'Script failed'; }
    }
    // Navigated/revoked documents cannot report; do not leak an unhandled rejection.
    try { await safeCall(reportResult, { id }, null, { callId, error }); } catch { /* disconnected */ }
  },
});

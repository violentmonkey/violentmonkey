import { MCP_ERROR_MAX, MCP_RESULT_MAX } from '../util';
import * as bridge from './bridge';

/** Handlers by script id and name. Each registration is a distinct object for `unregister`. */
const handlers = createNullObj();

/**
 * `GM.mcp` and `GM_mcp` for the script's context.
 * @param {GMContext} context
 */
export function makeMcpApi({ id }) {
  return {
    __proto__: null,
    register: defs => register(id, defs),
    report: (value, options) => send('McpReport', id, undefined, value, options),
  };
}

async function register(id, defs) {
  if (!isObject(defs)) throw new SafeError('GM.mcp.register expects an object of named handlers');
  const own = handlers[id] ||= createNullObj();
  const added = createNullObj();
  const previous = createNullObj();
  const list = [];
  for (const name of objectKeys(defs)) {
    const def = defs[name];
    const handle = def?.handle;
    if (!isFunction(handle)) throw new SafeError(`MCP handler "${name}" must have a handle function`);
    const { description, inputSchema } = def;
    if (description != null && !isString(description)) {
      throw new SafeError(`MCP handler "${name}" description must be a string`);
    }
    const schema = inputSchema == null ? undefined : jsonStringify(inputSchema);
    if (inputSchema != null && !isString(schema)) {
      throw new SafeError(`MCP handler "${name}" inputSchema must be JSON serializable`);
    }
    added[name] = { __proto__: null, def, handle };
    safePush(list, { __proto__: null, name, description, schema });
  }
  if (!list.length) throw new SafeError('GM.mcp.register needs at least one handler');
  // Install before acknowledging so an immediate call cannot race registration.
  for (const name in added) { /* proto is null */// eslint-disable-line guard-for-in
    previous[name] = own[name];
    own[name] = added[name];
  }
  try {
    await bridge.promise('McpRegister', { id, handlers: list });
  } catch (e) {
    for (const name in added) { /* proto is null */// eslint-disable-line guard-for-in
      if (own[name] !== added[name]) continue;
      if (previous[name]) own[name] = previous[name];
      else delete own[name];
    }
    throw e;
  }
  return async () => {
    const names = [];
    for (const name in added) { /* proto is null */// eslint-disable-line guard-for-in
      if (own[name] === added[name]) {
        delete own[name];
        safePush(names, name);
      }
    }
    if (names.length) await bridge.promise('McpUnregister', { id, names });
  };
}

/** Sends a handler's return value (McpReturn) or an explicit report (McpReport). */
async function send(cmd, id, callId, value, options) {
  const { error } = nullObjFrom(options);
  const json = jsonStringify(value === undefined ? null : value);
  if (json == null) throw new SafeError('MCP result must be JSON serializable');
  if (json.length > MCP_RESULT_MAX) throw new SafeError('MCP result exceeds 256k characters');
  await bridge.promise(cmd, {
    id,
    callId,
    json,
    error: error == null ? undefined : `${error}`::slice(0, MCP_ERROR_MAX),
  });
}

bridge.addHandlers({
  async McpCall({ id, args: { callId, handler, params } }) {
    const entry = handlers[id]?.[handler];
    let error;
    try {
      if (!entry) throw new SafeError(`MCP handler "${handler}" is no longer registered`);
      const { def, handle } = entry;
      const value = await def::handle({
        __proto__: null,
        params,
        // Bound to this call, so scripts never handle the call id themselves.
        report: (val, options) => send('McpReport', id, callId, val, options),
      });
      await send('McpReturn', id, callId, value);
      return;
    } catch (e) {
      try { error = `${e?.message || e}`; } catch { error = 'Script failed'; }
    }
    // Navigated/revoked documents cannot report; do not leak an unhandled rejection.
    try { await send('McpReturn', id, callId, null, { error }); } catch { /* disconnected */ }
  },
});

# Userscript MCP handlers and structured results

This change lets a userscript register named MCP handlers and report structured results to the existing MCP development tools. It requires the companion `script_handlers`, `script_call` and `script_results` schemas in the Violentmonkey MCP repository. Published servers that do not know those tools will not expose them. File saving and download-directory settings are outside this change.

Status: the API follows the shape agreed in review (`GM.mcp = { register, report }`, named handlers, call-bound `report`). As of 2026-11-03 all 46 real-browser regression cases pass in Chrome 156 with this extension's MV3 build and the companion MCP server. Firefox runtime checks are still pending.

## Example

```js
// ==UserScript==
// @name         MCP calculation example
// @namespace    mcp-example
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM.mcp
// ==/UserScript==

GM.mcp.register({
  sum: {
    description: 'Adds two numbers',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
    handle({ params, report }) {
      if (typeof params?.a !== 'number' || typeof params?.b !== 'number') {
        throw new Error('Expected numeric a and b');
      }
      setTimeout(() => report({ note: 'reported after the call settled' }), 1000);
      return { sum: params.a + params.b };
    },
  },
});

GM.mcp.report({ event: 'ready' });
```

`GM_mcp` is the same object for `@grant GM_mcp`.

### `register(handlers)`

Registers handlers by name and resolves to `unregister` once the extension accepted them. Names are 1–64 letters, digits, `_`, `.` or `-`. Registering an existing name replaces it and keeps the script's other handlers. A script may have up to 32 handlers per frame. The returned `unregister()` removes only the handlers this call added that were not replaced since.

`description` (up to 1,024 characters) and `inputSchema` (a JSON object up to 16k characters when serialized) are shown to the agent by `script_handlers`. The schema is a hint: the extension does not validate params against it, so the handler validates its own input.

### `handle({ params, report })`

The return value, or the value of a returned Promise, settles the call. `undefined` becomes `null`. Exceptions, rejected promises and serialization failures settle it as `failed`. A late return still settles a call that already timed out.

`report(value, { error }?)` is bound to the call, so scripts never handle call IDs. It adds a report attached to the call, may be called any number of times, and stays usable after the call settled or timed out. Reporting keeps the call retained. It rejects once the document was replaced or tab access revoked, and when the call is no longer retained.

### `report(value, { error }?)`

Adds a report that is not tied to a call. A script that only reports results need not register a handler.

## Try the paired changes

1. Build this extension with `pnpm build` or `pnpm build:mv3` and load the resulting build in the browser.
2. In the companion MCP checkout, run `pnpm install --frozen-lockfile` and `pnpm build`, then start `node packages/server/dist/cli.js -p 5678 --transport http`. Configure an MCP client with the emitted token and local endpoint, or use the CLI's default stdio transport.
3. Connect the extension using the server's authorization URL and approve it. Install the example script, grant the target tab from MCP settings and reload it.
4. Use `tabs_list` to get the tab ID, then call `script_handlers({ tabId })`. It lists `{ scriptId, frameId, handlers: [{ name, description, inputSchema }] }` per script and frame.
5. Call `script_call({ tabId, scriptId, handler: "sum", params: { a: 2, b: 3 }, callId: "sum-1" })`. Expect `result.status: "completed"` and `result.value.sum: 5`.
6. Read `script_results({ tabId, callId: "sum-1" })` for the call and, a second later, its report. Omitting `callId` also includes the `ready` report. Use `afterSeq` and the returned `nextSeq` to poll updates.

The extension's existing JavaScript MCP client transport can advertise the new tools without a dependency override. The companion server supplies the new schemas.

## Results

`script_results` returns two kinds of entries, ordered by `seq`:

- `kind: "call"` has `callId`, `handler`, `status` (`pending`, `completed`, `failed`, `timed_out` or `cancelled`), `startedAt`, and once settled `finishedAt` with `value` or `error`. Its `seq` changes when its status changes.
- `kind: "report"` has `value` or `error`, `reportedAt`, and `callId` when it belongs to a call.

Both have `scriptId`, `frameId` and an opaque `documentId`. Filtering by `callId` returns the call and its reports.

## Execution behavior

`script_call` requires `handler` and defaults to frame 0, `params: null`, `wait: true` and a 10,000 ms timeout. Set `wait: false` to receive an immediate pending record, then query results. Timeouts are limited to 1–25,000 ms. A successful MCP request can contain a `failed`, `timed_out` or `cancelled` call; inspect `result.status`.

Timeout does not stop the userscript or undo side effects. Reusing a retained call ID with the same script, frame, handler and serialized parameters returns the existing call without executing it again; conflicting reuse is rejected. This is an in-memory guarantee, not durable deduplication. After eviction or session reset, the same ID can execute again, and reports left from the evicted call are dropped.

Serialized parameters and results are each capped at 256k characters; error messages at 8,192 characters. A tab may have at most 32 pending calls. Settled calls and reports expire after five minutes and may be evicted earlier under the 100-entry/approximately 2 MiB retention limits. Reads return up to 100 entries and do not consume them. In MV3 the service worker is kept alive while a call is pending. Retained results and BFCache authorization live in memory, so a restarted worker loses them.

All three tools require a granted tab. Invocation also checks that the installed script remains enabled. Revocation, disconnect and tab closure clear channels and results. Document replacement cancels unfinished calls. Back/forward cache restoration renews the channel and restores handlers with their metadata in either parent/child event order without rerunning script initialization. Old return values and reports stay invalid. Revoking and regranting access does not resurrect a cached authorization session; reload after granting again.

Read-only servers expose discovery and results but omit `script_call`. Handler registration is deliberate participation by the script, not a security boundary against an agent already permitted to edit that script.

## Browser verification

On 2026-11-03, all 46 regression cases passed in Google Chrome 156.0.8078.80 on macOS arm64, using a headed browser with an isolated profile, the unpacked MV3 build and the per-extension "Allow User Scripts" switch. Calls travelled through an MCP SDK client, the paired local MCP HTTP server, the extension's WebSocket connection and installed userscripts. The extension backend was not mocked. One script used `GM_mcp` in the page realm and another `GM.mcp` in the content realm. Each ran in a top document, a same-origin iframe and a cross-origin iframe, registering 12 named handlers per frame.

| Area | Chrome result |
| --- | --- |
| Registration | Named handlers in both realms and all three frame contexts; descriptions and input schemas in `script_handlers`; `this` is the handler definition; `unregister()` removed only its own handler in its frame |
| Invocation and reporting | Synchronous and asynchronous returns, falsy JSON values, concurrent calls, call-bound reports before and after the call settled, unsolicited reports and result pagination passed |
| Errors and limits | Thrown errors, rejected promises, circular values, BigInt and oversized outputs settled calls as failed; unknown handlers, missing handler names, oversized inputs, invalid frames and disabled scripts were rejected |
| Call lifecycle | Duplicate IDs did not rerun a retained call; reuse with other params or another handler was rejected; `wait: false`, timeout and late completion passed |
| Navigation and BFCache | Back and forward restored callable handlers and their metadata, including an earlier `unregister()`, without repeating initialization; document IDs renewed and unfinished old calls stayed cancelled despite late replies; restored handlers could report after settling |
| Permissions and cleanup | Revoking access denied calls and reads; regranting did not revive an old cached session; reload, disconnect/reconnect, read-only mode and tab closure passed |

The BFCache checks observed trusted native `pageshow.persisted === true` events in the main document and both iframe origins, and unchanged script instances with initialization counts of one. No unexpected page JavaScript errors were observed. The automated extension suite (172 tests), lint, and both MV2 and MV3 builds also passed, as did the companion MCP suite (28 tests), typecheck and build.

Firefox has not been tested in a real browser for these changes. Repeat the call, authorization and navigation checks in Firefox before claiming cross-browser validation. In particular, verify actual persisted `pageshow` events, both script realms, same-origin and cross-origin frames, and rejection of old calls and revoked sessions. Successful compilation alone does not establish runtime behavior.

Chrome removed Manifest V2 support starting with version 139, as documented in the [official support timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline). The Chrome verification uses MV3.

The first round remains limited to script invocation and structured results. File saving is deferred to a separate round.

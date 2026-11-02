# Userscript callbacks and structured MCP results

This draft adds explicitly registered userscript callbacks and structured reports to the existing MCP development tools. It requires the companion `script_handlers`, `script_call` and `script_results` schemas in the Violentmonkey MCP repository. Published servers that do not know those tools will not expose them. File saving and download-directory settings are outside this change.

Status as of 2026-11-02: all 38 real-browser regression cases passed in Chrome 156 with this extension's MV3 build and the companion MCP server. The new API and its extension of the MCP development scope remain proposals for maintainer review. Firefox runtime checks are still pending.

## Example

```js
// ==UserScript==
// @name         MCP calculation example
// @namespace    mcp-example
// @version      1.0.0
// @match        https://example.com/*
// @grant        GM_registerMcpHandler
// @grant        GM_reportResult
// ==/UserScript==

GM_registerMcpHandler(async (params, { callId }) => {
  if (!params || typeof params.a !== 'number' || typeof params.b !== 'number') {
    throw new Error('Expected numeric a and b');
  }
  return { sum: params.a + params.b, callId };
});

GM_reportResult({ event: 'ready' });
```

`GM_registerMcpHandler` acknowledges registration with a Promise. There is one handler per script and frame; registering again replaces it. Return a JSON-serializable value or Promise from the handler. `undefined` becomes `null`; exceptions, rejected promises and serialization failures become failed execution records. The equivalent namespaced API is `GM.registerMcpHandler`.

`GM_reportResult(value, { callId?, error? }?)` creates an unsolicited result when `callId` is omitted, or completes a matching call when it is supplied. It resolves to `{ accepted, callId }`. Results cannot complete calls belonging to another script, frame or document channel. Duplicate terminal replies return `accepted: false`. `GM.reportResult` is also supported. A script that only reports results need not register a callback.

## Try the paired changes

1. Build this extension with `pnpm build` or `pnpm build:mv3` and load the resulting build in the browser.
2. In the companion MCP checkout, run `pnpm install --frozen-lockfile` and `pnpm build`, then start `node packages/server/dist/cli.js -p 5678 --transport http`. Configure an MCP client with the emitted token and local endpoint, or use the CLI's default stdio transport.
3. Connect the extension using the server's authorization URL and approve it. Install the example script, grant the target tab from MCP settings and reload it.
4. Use `tabs_list` and `scripts_list` to get real IDs, then call `script_handlers({ tabId })` to discover the script and frame.
5. Call `script_call({ tabId, scriptId, params: { a: 2, b: 3 }, callId: "sum-1" })`. Expect `result.status: "completed"` and `result.value.sum: 5`.
6. Read `script_results({ tabId, callId: "sum-1" })` for the same result. Omitting `callId` also includes the explicit `ready` report. Use `afterSeq` and the returned `nextSeq` to poll updates.

The extension's existing JavaScript MCP client transport can advertise the new tools without a dependency override. The companion server supplies the new schemas. No unpublished package version or local filesystem dependency is required in this extension's manifest.

## Execution behavior

`script_call` defaults to frame 0, `params: null`, `wait: true` and a 10,000 ms timeout. Set `wait: false` to receive an immediate pending record, then query results. Timeouts are limited to 1–25,000 ms. A successful MCP request can contain a `failed`, `timed_out` or `cancelled` execution; inspect `result.status`.

Timeout does not stop the userscript or undo side effects. Late results may complete a retained timed-out call. Reusing a retained call ID with the same script, frame and serialized parameters returns the existing call without executing it again; conflicting reuse is rejected. This is an in-memory guarantee, not durable deduplication. After eviction or session reset, the same ID can execute again.

Serialized parameters and results are each capped at 256 Ki characters; error messages at 8,192 characters. A tab may have at most 32 pending calls. Terminal results expire after five minutes and may be evicted earlier under the 100-record/approximately 2 MiB retention limits. Pending calls have their own per-call and concurrency bounds. Reads return up to 100 records and do not consume them.

All three tools require a granted tab. Invocation also checks that the installed script remains enabled. Revocation, disconnect and tab closure clear channels and results. Document replacement cancels unfinished calls. Back/forward cache restoration renews the channel and restores handlers in either parent/child event order without rerunning script initialization. Old call replies stay invalid. Revoking and regranting access does not resurrect a cached authorization session; reload after granting again.

Read-only servers expose discovery and results but omit `script_call`. Callback registration is deliberate participation by the script, not a security boundary against an agent already permitted to edit that script.

## Completed Chrome verification

On 2026-11-02, all 38 regression cases passed in Google Chrome 156.0.8078.79 on macOS arm64. The run used a headed browser with an isolated profile and the unpacked MV3 build (2.49.6), with developer mode and userscript execution enabled. Tested revisions: extension `f376fc5e7c13e24f026c0088640473c78ac88f8c`, paired with MCP `4fbc64eb1ac2d5347c8628730b06a4c3d97fd27a`.

Calls travelled through an MCP SDK client, the paired local MCP HTTP server, the extension's WebSocket connection and installed userscripts. The extension backend was not mocked. Two scripts exercised `GM_registerMcpHandler` / `GM_reportResult` in the page realm and `GM.registerMcpHandler` / `GM.reportResult` in the content realm. Each ran in a top document, a same-origin iframe and a cross-origin iframe, for six registered handlers.

| Area | Chrome result |
| --- | --- |
| Invocation and reporting | Synchronous and asynchronous returns, falsy JSON values, concurrent calls, unsolicited reports and result pagination passed |
| Errors and limits | Thrown errors, rejected promises, circular values, BigInt and oversized outputs produced failed execution records; oversized inputs, invalid frames and disabled scripts were rejected |
| Call lifecycle | Duplicate IDs did not rerun a retained call; conflicting reuse was rejected; `wait: false`, timeout and late completion passed |
| Navigation and BFCache | Back and forward restored callable handlers without repeating initialization; document tokens renewed and unfinished old calls stayed cancelled despite late replies |
| Permissions and cleanup | Revoking access denied calls and reads; regranting did not revive an old cached session; reload, disconnect/reconnect, read-only mode and tab closure passed |

The BFCache checks observed trusted native `pageshow.persisted === true` events in the main document and both iframe origins. They verified unchanged script closure instances and initialization counts of one after restoration. Restored scripts successfully reported results, and no unexpected page JavaScript errors were observed. A normal reload was tested separately and was not used as evidence of BFCache restoration.

The automated extension suite (141 tests), lint, and both MV2 and MV3 builds also passed. The companion MCP suite (25 tests), typecheck and build passed.

## Remaining browser verification

Firefox has not been tested in a real browser for these changes. Repeat the call, authorization and navigation checks in Firefox before claiming cross-browser validation. In particular, verify actual persisted `pageshow` events, both script realms, same-origin and cross-origin frames, and rejection of old calls and revoked sessions. Successful compilation alone does not establish runtime behavior.

Chrome removed Manifest V2 support starting with version 139, as documented in the [official support timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline). The completed Chrome verification uses MV3. Legacy Chrome MV2 runtime testing would require an explicitly agreed older-browser compatibility target, rather than being a requirement for current Chrome validation.

The first round remains limited to script invocation and structured results. File saving is deferred to a separate round.

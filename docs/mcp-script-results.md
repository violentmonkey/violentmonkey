# Userscript callbacks and structured MCP results

This draft adds explicitly registered userscript callbacks and structured reports to the existing MCP development tools. It requires the companion `script_handlers`, `script_call` and `script_results` schemas in the Violentmonkey MCP repository. Published servers that do not know those tools will not expose them. File saving and download-directory settings are outside this change.

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

## Browser verification before merge

Run the example in Chrome and Firefox with both `@inject-into page` and `@inject-into content`. Verify synchronous and asynchronous returns, thrown errors, invalid JSON returns, concurrent calls and `wait: false`. Try an iframe and confirm its returned `frameId` is required to invoke it.

Navigate from A to B, then back and forward. Verify that `pageshow.persisted` is true to exercise the cache path; a reload alone does not test restoration. Registered callbacks should remain callable without duplicate script initialization, while old calls and revoked sessions must remain invalid. Repeat with an iframe. Check disconnect/reconnect, tab closure, and missing tab grants. These real-browser checks complement the automated state and bridge tests.

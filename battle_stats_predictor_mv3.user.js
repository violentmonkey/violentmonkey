// ==UserScript==
// @name        Battle Stats Predictor
// @description Show battle stats prediction, computed by a third party service
// @version     9.4.1
// @namespace   tdup.battleStatsPredictor
// @updateURL   https://raw.githubusercontent.com/Zulenka/ProjectSol/master/battle_stats_predictor_mv3.user.js
// @downloadURL https://raw.githubusercontent.com/Zulenka/ProjectSol/master/battle_stats_predictor_mv3.user.js
// @match       https://www.torn.com/profiles.php*
// @match       https://www.torn.com/bringafriend.php*
// @match       https://www.torn.com/halloffame.php*
// @match       https://www.torn.com/index.php?page=people*
// @match       https://www.torn.com/factions.php*
// @match       https://www.torn.com/page.php*
// @match       https://www.torn.com/joblist.php*
// @match       https://www.torn.com/competition.php*
// @match       https://www.torn.com/bounties.php*
// @match       https://www.torn.com/hospitalview.php*
// @match       https://www.torn.com/forums.php*
// @match       https://www.torn.com/page.php?sid=list&type=friends
// @match       https://www.torn.com/page.php?sid=list&type=enemies
// @match       https://www.torn.com/page.php?sid=list&type=targets
// @match       https://www.torn.com/pmarket.php*
// @match       https://www.torn.com/properties.php*
// @match       https://www.torn.com/war.php*
// @match       https://www.torn.com/preferences.php*
// @match       https://www.torn.com/loader.php?sid=attack*
// @run-at      document-end
// @inject-into auto
// @grant       GM.xmlHttpRequest
// @grant       GM_xmlhttpRequest
// @grant       GM_info
// @connect     api.torn.com
// @connect     stormmotors.org
// @connect     www.tornstats.com
// @connect     yata.yt
// @license     MIT
// @author      TDup
// ==/UserScript==

// ##### INSTALLATION README #####
// ##### YOU SHOULD NOT NEED TO EDIT ANYTHING HERE
// ##### THE SETUP OF THIS SCRIPT IS DONE THROUGH THE BSP OPTION WINDOW, AVAILABLE ON YOUR TORN PROFILE PAGE, ONCE THIS SCRIPT IS INSTALLED
// ##### MORE INFO HERE : https://www.torn.com/forums.php#/p=threads&f=67&t=16290324&b=0&a=0&to=22705010

// #region MV3 / Userscript-manager compatibility (Violentmonkey MV3 friendly)
//
// MV3 note: userscript managers running on Manifest V3 use an extension *service worker* as the
// privileged background. Depending on the manager/version, GM.* APIs can be Promise-based
// (GM4-style) or callback-based (legacy). This layer normalizes the bits BSP relies on:
//   - script info (GM_info vs GM.info)
//   - BSPXmlHttpRequest(Promise vs callbacks)
//
// It also helps keep cross-origin requests out of the page context (content scripts are subject
// to SOP/CORS), by consistently using GM.xmlHttpRequest when available.
// #endregion

const BSP_GM = (typeof GM !== "undefined") ? GM : undefined;

function BSPGetGmInfo() {
    // Legacy (Tampermonkey, Violentmonkey compat)
    if (typeof GM_info !== "undefined" && GM_info) return GM_info;
    // GM4-style
    if (BSP_GM && BSP_GM.info) return BSP_GM.info;
    return undefined;
}

function BSPGetScriptVersion() {
    const info = BSPGetGmInfo();
    const v = info && info.script && info.script.version;
    return v || "unknown";
}

function BSPIsDebugEnabled() {
    // Reuse BSP's existing debug toggle (set in the Options UI).
    try { return GetStorage("tdup.battleStatsPredictor.showPredictionDetails") === "true"; }
    catch (_) { return false; }
}

function BSPMakeSafeUrl(url) {
    // Avoid dumping API keys (query strings) to the console.
    try {
        const u = new URL(url, window.location.href);
        return u.origin + u.pathname;
    } catch (_) {
        return String(url || "");
    }
}

function BSPEscapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function BSPSafeAttackHref(url) {
    try {
        const parsed = new URL(String(url || ""), window.location.href);
        if (parsed.origin !== "https://www.torn.com") return "#";
        return parsed.href;
    } catch (_) {
        return "#";
    }
}

function BSPSafeCssColor(value, fallback = "pink") {
    const v = String(value == null ? "" : value).trim();
    return /^[-#(),.%\sA-Za-z0-9]+$/.test(v) ? v : fallback;
}

function BSPSafeMargin(value, fallback = "0px") {
    const v = String(value == null ? "" : value).trim();
    return /^[-0-9px.%\s]+$/.test(v) ? v : fallback;
}

function BSPRunSelfChecks() {
    const failures = [];
    function expectEqual(name, actual, expected) {
        if (actual !== expected) {
            failures.push(name + " expected=" + String(expected) + " actual=" + String(actual));
        }
    }
    function expectTrue(name, value) {
        if (!value) failures.push(name + " expected=true actual=" + String(value));
    }

    expectEqual("safe-attack-href-valid", BSPSafeAttackHref("https://www.torn.com/profiles.php?XID=1"), "https://www.torn.com/profiles.php?XID=1");
    expectEqual("safe-attack-href-invalid", BSPSafeAttackHref("javascript:alert(1)"), "#");
    expectEqual("safe-css-color-invalid", BSPSafeCssColor("red;background:url(x)", "pink"), "pink");
    expectEqual("safe-margin-invalid", BSPSafeMargin("1px;position:absolute", "0px"), "0px");
    expectTrue("allowed-request-tornstats", BSPIsAllowedRequestUrl("https://www.tornstats.com/api/v2/x"));
    expectTrue("allowed-request-yata", BSPIsAllowedRequestUrl("https://yata.yt/api/v1/spies"));
    expectEqual("parse-numberish-comma", BSPParseNumberish("1,234"), 1234);
    expectEqual("prediction-expired-fresh", BSPIsPredictionExpired({ DateFetched: new Date().toISOString() }), false);
    expectEqual("prediction-expired-invalid", BSPIsPredictionExpired({ DateFetched: "not-a-date" }), true);
    const normalizedPrediction = BSPNormalizeCachedPredictionEntry({ Result: SUCCESS, TBS: "12345", Score: "321", DateFetched: new Date().toISOString() }, "selfcheck");
    expectEqual("normalized-prediction-schema", normalizedPrediction.CacheSchemaVersion, BSP_CACHE_SCHEMA_VERSION);
    const normalizedSpy = BSPNormalizeCachedSpyEntry({ timestamp: Math.floor(Date.now() / 1000), str: 1, def: 2, spd: 3, dex: 4, total: 10 }, "selfcheck");
    expectEqual("normalized-spy-schema", normalizedSpy.CacheSchemaVersion, BSP_CACHE_SCHEMA_VERSION);

    return {
        ok: failures.length === 0,
        failures: failures,
        checkedAt: new Date().toISOString()
    };
}

function BSPCreateIndicatorImage(src, width, height, margin) {
    if (!src) return null;
    var img = document.createElement("img");
    img.style.position = "absolute";
    img.style.width = width;
    img.style.height = height;
    img.style.margin = BSPSafeMargin(margin, "0px");
    img.style.zIndex = "101";
    img.src = src;
    return img;
}

function BSPPrependNode(parent, node) {
    if (!parent || !node) return;
    if (parent.firstChild) parent.insertBefore(node, parent.firstChild);
    else parent.appendChild(node);
}

function BSPCreateStatsBadgeLink(url, shouldOpenNewTab, indicatorSrc, indicatorMargin, isShowingHonorBars, mainMarginWhenDisplayingHonorBars, statsToSort, titleText, colorComparedToUs, formattedBattleStats) {
    var link = document.createElement("a");
    link.href = BSPSafeAttackHref(url);
    if (shouldOpenNewTab) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }

    var indicator = BSPCreateIndicatorImage(indicatorSrc, "13px", "13px", indicatorMargin);
    if (indicator) link.appendChild(indicator);

    var wrapper = document.createElement("div");
    if (isShowingHonorBars) {
        wrapper.style.position = "absolute";
        wrapper.style.zIndex = "100";
        wrapper.style.margin = BSPSafeMargin(mainMarginWhenDisplayingHonorBars, "0px");
    } else {
        wrapper.style.display = "inline-block";
        wrapper.style.marginRight = "5px";
    }

    var iconStats = document.createElement("div");
    iconStats.className = "iconStats";
    iconStats.setAttribute("data-bsp-stats", String(Number.isFinite(Number(statsToSort)) ? Number(statsToSort) : 0));
    if (titleText) iconStats.title = titleText;
    iconStats.style.background = BSPSafeCssColor(colorComparedToUs, "pink");
    iconStats.textContent = String(formattedBattleStats || "");

    wrapper.appendChild(iconStats);
    link.appendChild(wrapper);
    return link;
}

function BSPCreateApiRegisterLink(url, buttonText, buttonWidth) {
    var wrapper = document.createElement("div");
    wrapper.className = "TDup_optionsTabContentDiv";
    var link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    var button = document.createElement("input");
    button.type = "button";
    button.className = "TDup_buttonInOptionMenu";
    if (buttonWidth) {
        button.style.width = buttonWidth;
    }
    button.value = buttonText;
    link.appendChild(button);
    wrapper.appendChild(link);
    return wrapper;
}

function BSPSetSortButtonLabel(button, iconClassName) {
    if (!button) return;
    button.textContent = "";
    var icon = document.createElement("i");
    icon.className = "fa " + iconClassName;
    button.appendChild(icon);
    button.appendChild(document.createTextNode(" BSP"));
}

function BSPBuildSettingsButtonContent(fontSize, imageHeight) {
    var content = document.createElement("div");
    content.className = "TDup_button";
    content.style.fontSize = fontSize;
    var logo = document.createElement("img");
    logo.src = mainBSPIcon;
    logo.style.maxWidth = "100px";
    logo.style.maxHeight = imageHeight;
    logo.style.verticalAlign = "middle";
    content.appendChild(logo);
    content.appendChild(document.createTextNode("Settings"));
    return content;
}

const BSP_RUNTIME_KEY = "__tdup_bsp_mv3_runtime__";
const BSP_INSTANCE_ID = "bsp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
let BSP_RUNTIME_FALLBACK = { ownerInstanceId: null, ownerVersion: null, lastStatusKey: null, lastStatus: null };
const BSP_DIAGNOSTICS_MAX = 250;

function BSPGetRuntimeState() {
    try {
        if (!window[BSP_RUNTIME_KEY] || typeof window[BSP_RUNTIME_KEY] !== "object") {
            window[BSP_RUNTIME_KEY] = { ownerInstanceId: null, ownerVersion: null, lastStatusKey: null, lastStatus: null };
        }
        return window[BSP_RUNTIME_KEY];
    } catch (_) {
        return BSP_RUNTIME_FALLBACK;
    }
}

function BSPRenderStatusBanner(status) {
    if (!status || status.severity === "info") return;

    const render = () => {
        const root = document.body || document.documentElement;
        if (!root) return;

        let banner = document.getElementById("TDup_BSP_StatusBanner");
        if (!banner) {
            banner = document.createElement("div");
            banner.id = "TDup_BSP_StatusBanner";
            banner.style.position = "fixed";
            banner.style.top = "12px";
            banner.style.right = "12px";
            banner.style.maxWidth = "420px";
            banner.style.padding = "10px 12px";
            banner.style.border = "1px solid #333";
            banner.style.borderRadius = "6px";
            banner.style.fontFamily = "Arial, sans-serif";
            banner.style.fontSize = "12px";
            banner.style.lineHeight = "1.35";
            banner.style.zIndex = "2147483647";
            banner.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)";
            root.appendChild(banner);
        }

        banner.style.background = status.severity === "error" ? "#ffe3e3" : "#fff4d1";
        banner.style.color = "#111";
        banner.textContent = "";
        const strong = document.createElement("strong");
        strong.textContent = "BSP status:";
        banner.appendChild(strong);
        banner.appendChild(document.createTextNode(" " + String(status.message || "")));
    };

    if (document.readyState === "loading" && !document.body) {
        setTimeout(render, 0);
        return;
    }
    render();
}

function BSPGetDiagnosticsBuffer() {
    const state = BSPGetRuntimeState();
    if (!Array.isArray(state.diagnostics)) {
        state.diagnostics = [];
    }
    return state.diagnostics;
}

function BSPExposeDiagnostics() {
    try {
        window.__TDUP_BSP_DIAGNOSTICS__ = BSPGetDiagnosticsBuffer().slice();
        window.__TDUP_BSP_GET_DIAGNOSTICS__ = BSPGetDiagnosticsSnapshot;
    } catch (_) { }
}

function BSPPushDiagnostic(level, code, message, context) {
    const diagnostics = BSPGetDiagnosticsBuffer();
    diagnostics.push({
        time: new Date().toISOString(),
        level: String(level || "info"),
        code: String(code || "unspecified"),
        message: String(message || ""),
        context: context || null
    });
    if (diagnostics.length > BSP_DIAGNOSTICS_MAX) {
        diagnostics.splice(0, diagnostics.length - BSP_DIAGNOSTICS_MAX);
    }
    BSPExposeDiagnostics();
}

function BSPGetDiagnosticsSnapshot(limit = 100) {
    const diagnostics = BSPGetDiagnosticsBuffer();
    const max = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 100;
    return diagnostics.slice(Math.max(0, diagnostics.length - max));
}

function BSPClearDiagnostics() {
    const diagnostics = BSPGetDiagnosticsBuffer();
    diagnostics.length = 0;
    BSPExposeDiagnostics();
}

function BSPLogError(code, errorOrMessage, context = {}) {
    let message = "Unknown BSP error";
    let stack = "";
    if (errorOrMessage && typeof errorOrMessage === "object") {
        message = String(errorOrMessage.message || errorOrMessage);
        stack = String(errorOrMessage.stack || "");
    } else if (errorOrMessage != null) {
        message = String(errorOrMessage);
    }

    const diagnosticContext = Object.assign({}, context || {});
    if (stack) {
        diagnosticContext.stack = stack;
    }
    BSPPushDiagnostic("error", code || "error", message, diagnosticContext);

    if (BSPIsDebugEnabled()) {
        console.error("[BSP][" + String(code || "error") + "]", message, diagnosticContext);
    }
}

function BSPSetBootstrapState(state, context) {
    const runtime = BSPGetRuntimeState();
    runtime.bootstrapState = String(state || "unknown");
    runtime.bootstrapStateAt = new Date().toISOString();
    runtime.bootstrapContext = context || null;
    try {
        window.__TDUP_BSP_BOOTSTRAP_STATE__ = {
            state: runtime.bootstrapState,
            at: runtime.bootstrapStateAt,
            context: runtime.bootstrapContext
        };
    } catch (_) { }
}

function BSPGetManagerName() {
    const info = BSPGetGmInfo();
    if (!info) return "userscript manager";
    return String(
        info.scriptHandler
        || info.scriptHandlerName
        || info.scriptHandlerVersion
        || "userscript manager"
    );
}

function BSPGetMv3RemediationHint() {
    return "If using Chrome 138+, open Extensions > " + BSPGetManagerName() + " > Allow User Scripts, then reload the tab.";
}

function BSPRegisterGlobalErrorHandlers() {
    const state = BSPGetRuntimeState();
    if (state.globalErrorHandlersRegistered) return;
    state.globalErrorHandlersRegistered = true;

    try {
        window.addEventListener("error", function (evt) {
            if (!evt) return;
            BSPLogError("window-error", evt.error || evt.message || "Unknown window error", {
                filename: evt.filename || "",
                line: Number(evt.lineno || 0),
                column: Number(evt.colno || 0)
            });
        }, true);
    } catch (e) {
        BSPLogError("register-window-error-handler-failed", e, null);
    }

    try {
        window.addEventListener("unhandledrejection", function (evt) {
            if (!evt) return;
            const reason = evt.reason;
            BSPLogError("unhandled-rejection", reason || "Unhandled promise rejection", null);
        });
    } catch (e) {
        BSPLogError("register-unhandledrejection-handler-failed", e, null);
    }
}

function BSPFormatDiagnosticsForDisplay(entries) {
    if (!entries || entries.length === 0) return "No diagnostics captured yet.";
    return entries.map(function (entry) {
        let line = "[" + String(entry.time || "") + "] " + String(entry.level || "info").toUpperCase() + " " + String(entry.code || "") + " - " + String(entry.message || "");
        if (entry.context) {
            try {
                line += " | " + JSON.stringify(entry.context);
            } catch (_) {
                line += " | [context unavailable]";
            }
        }
        return line;
    }).join("\n");
}

function BSPSetStatus(message, severity = "info", options = {}) {
    const state = BSPGetRuntimeState();
    const key = options.code || (severity + ":" + message);
    if (!options.force && state.lastStatusKey === key) return;

    state.lastStatusKey = key;
    state.lastStatus = {
        message: message,
        severity: severity,
        time: new Date().toISOString()
    };

    try {
        window.__TDUP_BSP_LAST_STATUS__ = state.lastStatus;
    } catch (_) { }

    if (severity === "error")
        console.error("[BSP]", message);
    else if (severity === "warn")
        console.warn("[BSP]", message);

    BSPPushDiagnostic(severity, options.code || "status", message, options.context || null);
    BSPRenderStatusBanner(state.lastStatus);
}

function BSPReportRequestIssue(kind, details) {
    let method = (details && details.method) ? details.method : "GET";
    let safeUrl = BSPMakeSafeUrl(details && details.url);
    BSPSetStatus("Network request " + kind + " (" + method + " " + safeUrl + "). Predictions may stay stale until reload.", "warn", { code: "xhr-" + kind + "-" + safeUrl });
}

function BSPInvokeCallback(callback, args, contextCode) {
    if (typeof callback !== "function") return;
    try {
        callback.apply(null, Array.isArray(args) ? args : []);
    } catch (e) {
        BSPLogError("callback-invoke-failed", e, { contextCode: String(contextCode || "") });
    }
}

function BSPCheckInjectionMode() {
    const info = BSPGetGmInfo();
    const injectMode = info && (
        info.injectInto
        || (info.script && info.script.options && info.script.options.injectInto)
    );
    if (!injectMode) return;
    const normalized = String(injectMode).toLowerCase();
    if (normalized !== "content") {
        BSPSetStatus("BSP is running in '" + injectMode + "' mode. Use content injection for MV3/CSP stability.", "warn", {
            code: "inject-mode-non-content",
            context: { injectMode: injectMode }
        });
    }
}

function BSPNoCacheUrl(url) {
    let separator = url.includes("?") ? "&" : "?";
    return url + separator + "_bsp_ts=" + Date.now();
}

function BSPIsAllowedRequestUrl(url) {
    try {
        const parsed = new URL(String(url || ""), window.location.href);
        if (parsed.origin === window.location.origin) return true;
        const host = String(parsed.hostname || "").toLowerCase();
        return host === "api.torn.com"
            || host === "www.torn.com"
            || host === "stormmotors.org"
            || host === "www.tornstats.com"
            || host === "yata.yt";
    } catch (_) {
        return false;
    }
}

function BSPEnsureSingleton() {
    const state = BSPGetRuntimeState();
    if (state.ownerInstanceId && state.ownerInstanceId !== BSP_INSTANCE_ID) {
        BSPSetStatus("Another BSP script instance is already active on this page. Disable duplicate installs (old + MV3) and reload.", "error", { code: "duplicate-instance" });
        return false;
    }
    state.ownerInstanceId = BSP_INSTANCE_ID;
    state.ownerVersion = BSPGetScriptVersion();
    return true;
}

function BSPDetectPreexistingBspUi() {
    try {
        const findings = [];
        const buttonCount = document.querySelectorAll(".TDup_divBtnBsp").length;
        const gridOverlayCount = document.querySelectorAll(".TDup_ColoredStatsInjectionDiv, .TDup_ColoredStatsInjectionDivWithoutHonorBar").length;
        const attackOverlayCount = document.querySelectorAll(".iconStatsAttack").length;

        if (document.getElementById("TDup_PredictorOptionsDiv")) findings.push("settings window");
        if (buttonCount > 0) findings.push(buttonCount + " BSP button(s)");
        if (gridOverlayCount > 0) findings.push(gridOverlayCount + " grid overlay(s)");
        if (attackOverlayCount > 0) findings.push(attackOverlayCount + " attack overlay(s)");

        if (findings.length > 0) {
            BSPSetStatus("Another BSP UI is already present before MV3 startup (" + findings.join(", ") + "). Disable duplicate BSP installs and reload.", "warn", { code: "preexisting-bsp-ui" });
        }
    } catch (e) {
        BSPLogError("detect-preexisting-ui-failed", e, null);
    }
}

function BSPRemoveExistingAttackStatsOverlays(container) {
    if (!container || !container.querySelectorAll) return 0;

    let removed = 0;
    const overlays = Array.from(container.querySelectorAll(".iconStatsAttack"));
    overlays.forEach((overlay) => {
        let node = overlay;
        while (node && node.parentElement && node.parentElement !== container) {
            node = node.parentElement;
        }
        if (node && node.parentElement === container) {
            node.remove();
            removed++;
            return;
        }
        if (overlay.parentElement) {
            overlay.parentElement.remove();
            removed++;
        }
    });

    return removed;
}


/**
 * MV3-friendly GM.xmlHttpRequest wrapper.
 *
 * - Works when GM.xmlHttpRequest is callback-based (classic).
 * - Works when GM.xmlHttpRequest returns a Promise (GM4-style).
 * - Always returns a Promise that resolves with the response object.
 */
function BSPXmlHttpRequest(details) {
    const xhrFn =
        (BSP_GM && BSP_GM.xmlHttpRequest) ||
        (typeof GM_xmlhttpRequest !== "undefined" && GM_xmlhttpRequest);

    return new Promise((resolve, reject) => {
        if (!xhrFn) {
            const err = new Error("BSP: GM.xmlHttpRequest is not available. Check @grant + @connect permissions in your userscript manager.");
            BSPSetStatus("GM.xmlHttpRequest is unavailable. Check userscript manager permissions (@grant/@connect). " + BSPGetMv3RemediationHint(), "error", { code: "gm-xhr-missing" });
            if (BSPIsDebugEnabled()) {
                console.warn("[BSP] GM.xmlHttpRequest missing. This usually means the script lacks @grant/@connect permissions in your userscript manager.", err);
            }
            try { details && typeof details.onerror === "function" && details.onerror(err); } catch (e) {
                BSPLogError("missing-gm-onerror-callback-failed", e, null);
            }
            reject(err);
            return;
        }

        let settled = false;
        let loadCalled = false;
        let errorCalled = false;

        const doneResolve = (v) => {
            if (settled) return;
            settled = true;
            resolve(v);
        };
        const doneReject = (e) => {
            if (settled) return;
            settled = true;
            reject(e);
        };

        const d = Object.assign({}, details);

        const userOnload = d.onload;
        const userOnerror = d.onerror;
        const userOntimeout = d.ontimeout;
        const userOnabort = d.onabort;

        if (!BSPIsAllowedRequestUrl(d.url)) {
            const err = new Error("BSP blocked request to a non-allowlisted host.");
            BSPLogError("request-host-blocked", err, { url: BSPMakeSafeUrl(d.url), method: String(d.method || "GET") });
            if (typeof userOnerror === "function") {
                try { userOnerror(err); } catch (e) {
                    BSPLogError("request-host-blocked-onerror-callback-failed", e, null);
                }
            }
            doneReject(err);
            return;
        }

        d.onload = (resp) => {
            loadCalled = true;
            try { typeof userOnload === "function" && userOnload(resp); }
            finally { doneResolve(resp); }
        };
        d.onerror = (err) => {
            errorCalled = true;
            BSPReportRequestIssue("failed", d);
            if (BSPIsDebugEnabled()) {
                console.warn("[BSP] XHR error", { method: d.method, url: BSPMakeSafeUrl(d.url), err });
            }
            try { typeof userOnerror === "function" && userOnerror(err); }
            finally { doneReject(err); }
        };
        d.ontimeout = (err) => {
            errorCalled = true;
            BSPReportRequestIssue("timed out", d);
            if (BSPIsDebugEnabled()) {
                console.warn("[BSP] XHR timeout", { method: d.method, url: BSPMakeSafeUrl(d.url), err });
            }
            try { typeof userOntimeout === "function" && userOntimeout(err); }
            finally { doneReject(err || new Error("BSP: XHR timeout")); }
        };
        d.onabort = (err) => {
            errorCalled = true;
            BSPReportRequestIssue("aborted", d);
            if (BSPIsDebugEnabled()) {
                console.warn("[BSP] XHR aborted", { method: d.method, url: BSPMakeSafeUrl(d.url), err });
            }
            try { typeof userOnabort === "function" && userOnabort(err); }
            finally { doneReject(err || new Error("BSP: XHR aborted")); }
        };

        // Defensive default timeout: MV3 service workers can be killed if a request hangs.
        if (d.timeout == null) d.timeout = 45000;

        let ret;
        try {
            ret = xhrFn(d);
        } catch (e) {
            BSPLogError("gm-xhr-call-failed", e, { method: String(d.method || "GET"), url: BSPMakeSafeUrl(d.url) });
            d.onerror(e);
            return;
        }

        // Promise-based GM4-style API.
        if (ret && typeof ret.then === "function") {
            ret.then((resp) => {
                // If callbacks weren't invoked by the implementation, invoke them once.
                if (!loadCalled && !errorCalled) d.onload(resp);
                else doneResolve(resp);
            }).catch((err) => {
                if (!errorCalled) d.onerror(err);
                else doneReject(err);
            });
        }
    });
}

// #region LocalStorage

const BSP_STORAGE_PREFIX = "tdup.battleStatsPredictor.";

const StorageKey = {
    // Used for identification to the third party (lolmanager, website handling the predictions) + doing Torn API calls on the backend, when target stats are not cached yet. Doesn't require any kind of abilitation.
    // This is the only key sent to the BSP backend.
    PrimaryAPIKey: 'tdup.battleStatsPredictor.PrimaryAPIKey',
    IsPrimaryAPIKeyValid: 'tdup.battleStatsPredictor.IsPrimaryAPIKeyValid',

    // To avoid showing prediction on own profile
    PlayerId: 'tdup.battleStatsPredictor.PlayerId',
    IsEnabledOnOwnProfile: 'tdup.battleStatsPredictor.IsEnabledOnOwnProfile',

    // Used only on the client side, to import user battlestats. This is not required but useful to have your stats up to date locally, for accurate color code.
    // You can fill manually your stats, or not fill your stat at all, and don't use the color code system.
    // This data is only kept in your local cache, no battle stats are sent to the BSP backend
    BattleStatsAPIKey: 'tdup.battleStatsPredictor.BattleStatsApiKey',
    IsBattleStatsAPIKeyValid: 'tdup.battleStatsPredictor.IsBattleStatsApiKeyValid',
    // Can be edited manually, or imported directly through the API
    PlayerBattleStats: 'tdup.battleStatsPredictor.playerBattleStats',
    IsAutoImportStats: 'tdup.battleStatsPredictor.IsAutoImportStats',
    AutoImportStatsLastDate: 'tdup.battleStatsPredictor.AutoImportStatsLastDate',

    // Predictions
    BSPPrediction: 'tdup.battleStatsPredictor.cache.prediction.',

    // Used only on the client side, to import spies from TornStats.
    // Spies are only kept in your local cache, no spies is sent to the BSP backend.
    TornStatsAPIKey: 'tdup.battleStatsPredictor.TornStatsApiKey',
    IsTornStatsAPIKeyValid: 'tdup.battleStatsPredictor.IsTornStatsApiKeyValid',
    TornStatsSpy: 'tdup.battleStatsPredictor.cache.spy_v2.tornstats_',
    IsAutoImportTornStatsSpies: 'tdup.battleStatsPredictor.tornstats_isAutoImportSpies',
    AutoImportLastDatePlayer: 'tdup.battleStatsPredictor.tornstats_AutoImportLastDatePlayer_',
    AutoImportLastDateFaction: 'tdup.battleStatsPredictor.tornstats_AutoImportLastDateFaction_',

    UploadDataAPIKey: 'tdup.battleStatsPredictor.UploadDataAPIKey',
    UploadDataAPIKeyIsValid: 'tdup.battleStatsPredictor.UploadDataAPIKeyIsValid',
    UploadDataLastUploadTime: 'tdup.battleStatsPredictor.UploadDataLastUploadTime',
    UploadDataIsAutoMode: 'tdup.battleStatsPredictor.UploadDataIsAutoMode',

    YataAPIKey: 'tdup.battleStatsPredictor.YataApiKey',
    IsYataAPIKeyValid: 'tdup.battleStatsPredictor.IsYataApiKeyValid',
    YataSpy: 'tdup.battleStatsPredictor.cache.spy_v2.yata_',

    DaysToUseSpies: 'tdup.battleStatsPredictor.DaysToUseTornStatsSpy',

    // Subscription
    DateSubscriptionEnd: 'tdup.battleStatsPredictor.dateSubscriptionEnd',

    // Debug options
    ShowPredictionDetails: 'tdup.battleStatsPredictor.showPredictionDetails',

    // Pages enabled
    IsBSPEnabledOnPage: 'tdup.battleStatsPredictor.IsBSPEnabledOnPage_',

    ShouldOpenAttackURLInNewTab: 'tdup.battleStatsPredictor.ShouldOpenAttackURLInNewTab',

    // Display choice
    IsShowingHonorBars: 'tdup.battleStatsPredictor.isShowingHonorBars',
    IsShowingAlternativeProfileDisplay: 'tdup.battleStatsPredictor.isShowingAlternativeProfileDisplay',
    BSPColorTheme: 'tdup.battleStatsPredictor.BspColorTheme',
    ColorStatsThreshold: 'tdup.battleStatsPredictor.ColorStatsThreshold_',
    IsShowingBattleStatsScore: 'tdup.battleStatsPredictor.IsShowingBattleStatsScore',
    IsShowingBattleStatsPercentage: 'tdup.battleStatsPredictor.IsShowingBattleStatsPercentage',
    IsClickingOnProfileStatsAttackPlayer: 'tdup.battleStatsPredictor.IsClickingOnProfileStatsAttackPlayer',
    IsHidingBSPOptionButtonInToolbar: 'tdup.battleStatsPredictor.IsHidingBSPOptionButtonInToolbar',
    HasSortByBSPButtonsOnFactionPage: 'tdup.battleStatsPredictor.HasSortByBSPButtonsOnFactionPage',

    // Cache management
    AutoClearOutdatedCacheLastDate: 'tdup.battleStatsPredictor.AutoClearOutdatedCacheLastDate',
    AutoClearOutdatedSpyCacheLastDate: 'tdup.battleStatsPredictor.AutoClearOutdatedSpyCacheLastDate',
    TestLocalStorageKey: 'tdup.battleStatsPredictor.TestLocalStorage',
};

function CanQueryAnyAPI() {
    return document.visibilityState === "visible" && document.hasFocus();
}
function GetBSPServer() {
    return "https://stormmotors.org/api";
}
function BSPStorageGetRaw(key) { return localStorage[key]; }
function BSPStorageSetRaw(key, value) { localStorage[key] = value; }
function BSPStorageRemove(key) { localStorage.removeItem(key); }
function BSPStorageKeys() { return Object.keys(localStorage); }
function BSPStorageIsManagedKey(key) { return String(key || "").startsWith(BSP_STORAGE_PREFIX); }
function BSPStorageGetJson(key, fallbackValue, options = {}) {
    const raw = BSPStorageGetRaw(key);
    if (raw == undefined || raw === "") return fallbackValue;
    const parsed = JSONparse(raw);
    if (parsed == null) {
        if (options.removeInvalid !== false) {
            BSPStorageRemove(key);
        }
        BSPLogError(options.errorCode || "storage-json-invalid", "Invalid JSON in storage", { key: String(key || "") });
        return fallbackValue;
    }
    return parsed;
}
function BSPStorageSetJson(key, value) {
    SetStorage(key, JSON.stringify(value));
}
function BSPStorageGetInt(key, fallbackValue) {
    const raw = BSPStorageGetRaw(key);
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed;
    if (fallbackValue != undefined) {
        SetStorage(key, fallbackValue);
        return parseInt(fallbackValue, 10);
    }
    return parsed;
}
function GetStorage(key) { return BSPStorageGetRaw(key); }
function GetStorageEmptyIfUndefined(key) { return (BSPStorageGetRaw(key) == undefined) ? "" : BSPStorageGetRaw(key); }
function GetStorageBool(key) { return (BSPStorageGetRaw(key) == "true") ? true : false; }
function GetStorageBoolWithDefaultValue(key, defaultValueIfUnset) {
    if (BSPStorageGetRaw(key) == "true") return true;
    else if (BSPStorageGetRaw(key) == "false") return false;
    else {
        SetStorage(key, defaultValueIfUnset);
        return defaultValueIfUnset;
    }
}
function SetStorage(key, value) {
    try {
        BSPStorageSetRaw(key, value);
    }
    catch (e) {
        BSPSetStatus("BSP could not write browser storage (it may be full). Open BSP Settings > Debug and clear cache/chat entries.", "warn", { code: "localstorage-write-failed" });
        BSPLogError("localstorage-write-failed", e, { key: String(key || "") });
        LogInfo("BSP threw an exception in SetStorage method : " + e);
    }
}

function GetLocalBattleStats() {
    let data = BSPStorageGetJson(StorageKey.PlayerBattleStats, undefined, { errorCode: "local-battlestats-json-invalid" });
    if (data == undefined) {
        let localBattleStats = new Object();
        localBattleStats.Str = 0;
        localBattleStats.Def = 0;
        localBattleStats.Spd = 0;
        localBattleStats.Dex = 0;
        localBattleStats.TBS = 0;
        localBattleStats.Score = 0;
        SetLocalBattleStats(localBattleStats);
        return localBattleStats;
    }
    return data;
}
function SetLocalBattleStats(value) {
    BSPStorageSetJson(StorageKey.PlayerBattleStats, value);
}

// #endregion

// #region Global vars

const LOCAL_COLORS = [
    { maxValue: 5, maxValueScore: 30, color: '#949494', canModify: true },
    { maxValue: 35, maxValueScore: 70, color: '#FFFFFF', canModify: true },
    { maxValue: 75, maxValueScore: 90, color: '#73DF5D', canModify: true },
    { maxValue: 125, maxValueScore: 105, color: '#47A6FF', canModify: true },
    { maxValue: 400, maxValueScore: 115, color: '#FFB30F', canModify: true },
    { maxValue: 10000000000, maxValueScore: 10000000000, color: '#FF0000', canModify: false },
];

var FAIL = 0;
var SUCCESS = 1;
var TOO_WEAK = 2;
var TOO_STRONG = 3;
var MODEL_ERROR = 4;
var HOF = 5;
var FFATTACKS = 6;

var apiRegister;
var comparisonBattleStatsText;
var scoreStrInput;
var scoreDefInput;
var scoreSpdInput;
var scoreDexInput;
var subscriptionEndText;
var divThresholdColorsPanel;

var btnValidateTornStatsAPIKey;
var successValidateTornStatsAPIKey;
var errorValidateTornStatsAPIKey;
var btnImportTornStatsSpies;
var successImportTornStatsSpies;
var errorImportTornStatsSpies;
var mainNode;

var btnFetchSpiesFromYata;
var successValidateYataAPIKey;
var errorValidateYataAPIKey;
var btnImportYataSpies;
var successImportYataSpies;
var errorImportYataSpies;

var TDup_PredictorOptionsDiv;
var TDup_PredictorOptionsMenuArea;
var TDup_PredictorOptionsContentArea;

var ProfileTargetId = -1;
var FactionTargetId = -1;
var PlayerProfileDivWhereToInject;
var dictDivPerPlayer = {};

var OnMobile = false;

var PREDICTION_VALIDITY_DAYS = 5;
var SPY_CACHE_VALIDITY_DAYS = 180;

var mainColor = "#344556";
var mainBSPIcon = "https://i.postimg.cc/K8cNpzCS/BSPLogo11low.png";

var tornstatsIcon = "https://i.postimg.cc/k5HjhCLV/tornstats-logo.png";
var yataIcon = "https://i.ibb.co/hYvQC2L/yata.png";

var starIcon = "https://i.ibb.co/23TYRyL/star-v2.png";
var oldSpyIcon = "https://i.ibb.co/b7982wh/oldSpy.png";
var hofIcon = "https://i.ibb.co/fkFDrVx/HOF-v2.png";
var FFAttacksIcon = "https://i.ibb.co/GJ04WJn/player-Data-v2.png";

var URL_TORN_ATTACK = "https://www.torn.com/loader.php?sid=attack&user2ID=";

// #endregion

// #region Styles

var styleToAdd = document.createElement('style');
var themeColor = BSPSafeCssColor(GetColorTheme(), mainColor);
var styleRules = [
    '.iconStats {height: 20px; width: 32px; position: relative; text-align: center; font-size: 12px; font-weight:bold; color: black; box-sizing: border-box; border: 1px solid black;line-height: 18px;font-family: initial;}',
    '.iconStatsAttack {height: 30px; width: 80px; position: relative; text-align: center; font-size: 28px; font-weight:bold; color: black; box-sizing: border-box; border: 1px solid black;line-height: 28px;font-family: initial;}',
    '.TDup_optionsMenu {border: 1px solid #ccc;background-color: #f1f1f1;}',
    '.TDup_optionsMenu button {display: block; text-align:center !important; height:45px; background-color: inherit; color: black; padding: 22px 16px; width: 100%; border: none; outline: none; text-align: left; cursor: pointer; transition: 0.3s;font-size: 14px; border: 1px solid white !important}',
    '.TDup_optionsMenu button:hover button:focus { background-color: #99ccff !important; color: black !important}',
    '.TDup_optionsMenu button.active { background-color: ' + themeColor + ' !important; color:white}',
    '.TDup_optionsCellMenu {width:100px; background:white; height:370px; vertical-align: top !important;}',
    '.TDup_optionsCellHeader {text-align: center; font-size: 18px !important; background:' + themeColor + '; color: white;}',
    '.TDup_divBtnBsp {width: initial !important;}',
    '.TDup_buttonInOptionMenu { background-color: ' + themeColor + '; border-radius: 4px; border-style: none; box-sizing: border-box; color: #fff;cursor: pointer;display: inline-block; font-family: \"Farfetch Basis\", \"Helvetica Neue\", Arial, sans-serif;font-size: 12px; margin: 5px; max-width: none; outline: none;overflow: hidden;  padding: 5px 5px; position: relative;  text-align: center;}',
    '.TDup_optionsTabContentDiv { padding: 10px 6px;}',
    '.TDup_optionsTabContentDiv a { display: initial !important;}',
    '.TDup_optionsTabContentDivSmall { padding: 5px 5px;}',
    '.TDup_optionsTabContent { padding: 10px 10px;  border: 1px solid #ccc;  }',
    '.TDup_optionsTabContent label { margin:10px 0px; }',
    '.TDup_optionsTabContent p { margin:10px 0px; }',
    '.TDup_optionsTabContent a { color:black !important;}',
    '.TDup_ColoredStatsInjectionDiv { position:absolute;}',
    '.TDup_ColoredStatsInjectionDivWithoutHonorBar { }',
    '.TDup_optionsTabContent input { margin:0px 10px !important; }',
    '.TDup_optionsTabContent input[type = button] { margin:0px 10px 0px 0px !important; }',
    '.TDup_optionsTabContent input:disabled[type = button] { background-color: #AAAAAA; }',
    '.TDup_optionsTabContent input[type = number] { text-align: right; }',
    '.TDup_button {  background-color: ' + themeColor + '; border-radius: 4px; border-style: none; box-sizing: border-box; color: #fff;cursor: pointer;display: inline-block; font-family: \"Farfetch Basis\", \"Helvetica Neue\", Arial, sans-serif;font-size: 12px;font-weight: 100; line-height: 1;  margin: 0; max-width: none; min-width: 10px;  outline: none;overflow: hidden;  padding: 5px 5px; position: relative;  text-align: center;text-transform: none;  user-select: none; -webkit-user-select: none;  touch-action: manipulation; width: 100%;}',
    '.TDup_button:hover, .TDup_button:focus { opacity: .75;}'
];
styleToAdd.textContent = styleRules.join('\\n');

var ref = document.querySelector('script');

var styleInjected = false;
if (ref != undefined && ref.parentNode != undefined) {
    ref.parentNode.insertBefore(styleToAdd, ref);
    styleInjected = true;
}

// #endregion

// #region Utils

const PageType = {
    Profile: 'Profile',
    RecruitCitizens: 'Recruit Citizens',
    HallOfFame: 'Hall Of Fame',
    Faction: 'Faction',
    Company: 'Company',
    Competition: 'Competition',
    Elimination: 'Elimination',
    EliminationAttacks: 'EliminationAttacks',
    EliminationRevenge: 'EliminationRevenge',
    Bounty: 'Bounty',
    Search: 'Search',
    Hospital: 'Hospital',
    Chain: 'Chain',
    FactionControl: 'Faction Control',
    FactionControlPayday: 'Faction Control Per Day',
    FactionControlApplications: 'Faction Control Applications',
    Market: 'Market',
    Forum: 'Forum',
    ForumThread: 'ForumThread',
    ForumSearch: 'ForumSearch',
    Abroad: 'Abroad',
    Enemies: 'Enemies',
    Friends: 'Friends',
    Targets: 'Targets',
    PointMarket: 'Point Market',
    Properties: 'Properties',
    War: 'War',
    ChainReport: 'ChainReport',
    RWReport: 'RWReport',
    Attack: 'Attack',
    RussianRoulette: 'Russian Roulette',
};

var mapPageTypeAddress = {
    [PageType.Profile]: 'https://www.torn.com/profiles.php',
    [PageType.RecruitCitizens]: 'https://www.torn.com/bringafriend.php',
    [PageType.HallOfFame]: 'https://www.torn.com/page.php?sid=hof',
    [PageType.Faction]: 'https://www.torn.com/factions.php',
    [PageType.Company]: 'https://www.torn.com/joblist.php',
    [PageType.Competition]: 'https://www.torn.com/competition.php',
    [PageType.Elimination]: 'https://www.torn.com/page.php?sid=competition',
    [PageType.EliminationAttacks]: 'https://www.torn.com/page.php?sid=competition#/attacks',
    [PageType.EliminationRevenge]: 'https://www.torn.com/page.php?sid=competition#/revenge',
    [PageType.Bounty]: 'https://www.torn.com/bounties.php',
    [PageType.Search]: 'https://www.torn.com/page.php?sid=UserList',
    [PageType.Hospital]: 'https://www.torn.com/hospitalview.php',
    [PageType.Chain]: 'https://www.torn.com/factions.php?step=your#/war/chain',
    [PageType.FactionControl]: 'https://www.torn.com/factions.php?step=your#/tab=controls',
    [PageType.FactionControlPayday]: 'https://www.torn.com/factions.php?step=your#/tab=controls',
    [PageType.FactionControlApplications]: 'https://www.torn.com/factions.php?step=your#/tab=controls',
    [PageType.Market]: 'https://www.torn.com/page.php?sid=ItemMarket',
    [PageType.Forum]: 'https://www.torn.com/forums.php',
    [PageType.ForumThread]: 'https://www.torn.com/forums.php#/p=threads',
    [PageType.ForumSearch]: 'https://www.torn.com/forums.php#/p=search',
    [PageType.Abroad]: 'https://www.torn.com/index.php?page=people',
    [PageType.Enemies]: 'https://www.torn.com/page.php?sid=list&type=enemies',
    [PageType.Friends]: 'https://www.torn.com/page.php?sid=list&type=friends',
    [PageType.Targets]: 'https://www.torn.com/page.php?sid=list&type=targets',
    [PageType.PointMarket]: 'https://www.torn.com/pmarket.php',
    [PageType.Properties]: 'https://www.torn.com/properties.php',
    [PageType.War]: 'https://www.torn.com/war.php',
    [PageType.ChainReport]: 'https://www.torn.com/war.php?step=chainreport',
    [PageType.RWReport]: 'https://www.torn.com/war.php?step=rankreport',
    [PageType.Attack]: 'https://www.torn.com/loader.php?sid=attack',
    [PageType.RussianRoulette]: 'https://www.torn.com/page.php?sid=russianRoulette',
}

var mapPageAddressEndWith = {
    [PageType.FactionControl]: '/tab=controls',
    [PageType.FactionControlPayday]: 'tab=controls&option=pay-day',
    [PageType.FactionControlApplications]: 'tab=controls&option=application'
}


function LogInfo(value) {
    var now = new Date();
    let message = ": [** BSP **] " + now.toISOString() + " - " + value;
    console.log(message);
    BSPPushDiagnostic("info", "log", String(value || ""), null);
}

function JSONparse(str) {
    try {
        return JSON.parse(str);
    } catch (e) { }
    return null;
}

function BSPParseResponseJson(response, sourceCode) {
    const parsed = JSONparse(response && response.responseText);
    if (parsed == null) {
        throw new Error("Invalid JSON response (" + String(sourceCode || "unknown") + ")");
    }
    return parsed;
}

function BSPEnsureRecord(value, sourceCode) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid response shape (" + String(sourceCode || "unknown") + ")");
    }
    return value;
}

function BSPParseNumberish(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value === "string") {
        const cleaned = value.replace(/,/g, "").trim();
        if (!cleaned) return NaN;
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
}

function BSPRequireNumberField(value, sourceCode, fieldName, options = {}) {
    const parsed = BSPParseNumberish(value);
    if (!Number.isFinite(parsed)) {
        throw new Error("Invalid numeric field '" + String(fieldName || "unknown") + "' (" + String(sourceCode || "unknown") + ")");
    }
    if (options.integer === true && !Number.isInteger(parsed)) {
        throw new Error("Expected integer field '" + String(fieldName || "unknown") + "' (" + String(sourceCode || "unknown") + ")");
    }
    if (Number.isFinite(options.min) && parsed < options.min) {
        throw new Error("Out-of-range field '" + String(fieldName || "unknown") + "' (" + String(sourceCode || "unknown") + ")");
    }
    return parsed;
}

function BSPNormalizeBoolean(value, fallbackValue = false) {
    if (value === true || value === false) return value;
    if (value === 1 || value === "1") return true;
    if (value === 0 || value === "0") return false;
    return fallbackValue;
}

function BSPNormalizeBspPredictionResponse(payload, sourceCode) {
    const data = BSPEnsureRecord(payload, sourceCode || "bsp-score");
    const normalized = Object.assign({}, data);
    normalized.Result = BSPRequireNumberField(data.Result, sourceCode || "bsp-score", "Result", { integer: true });

    if (normalized.Result !== FAIL && normalized.Result !== MODEL_ERROR) {
        normalized.TBS = BSPRequireNumberField(data.TBS, sourceCode || "bsp-score", "TBS", { min: 0 });
        normalized.Score = BSPRequireNumberField(data.Score, sourceCode || "bsp-score", "Score", { min: 0 });
    } else {
        const parsedTbs = BSPParseNumberish(data.TBS);
        const parsedScore = BSPParseNumberish(data.Score);
        if (Number.isFinite(parsedTbs)) normalized.TBS = parsedTbs;
        if (Number.isFinite(parsedScore)) normalized.Score = parsedScore;
    }

    return normalized;
}

function BSPNormalizeBspUserDataResponse(payload, sourceCode) {
    const data = BSPEnsureRecord(payload, sourceCode || "bsp-user-data");
    const subscriptionDate = new Date(data.SubscriptionEnd);
    if (isNaN(subscriptionDate.getTime())) {
        throw new Error("Invalid subscription date (" + String(sourceCode || "bsp-user-data") + ")");
    }
    const subscriptionState = BSPParseNumberish(data.SubscriptionState);

    return Object.assign({}, data, {
        SubscriptionEnd: subscriptionDate.toISOString(),
        SubscriptionActive: BSPNormalizeBoolean(data.SubscriptionActive, false),
        SubscriptionState: Number.isFinite(subscriptionState) ? parseInt(subscriptionState, 10) : 0
    });
}

function BSPNormalizeBspUploadResponse(payload, sourceCode) {
    const data = BSPEnsureRecord(payload, sourceCode || "bsp-upload-stats");
    return Object.assign({}, data, {
        Result: BSPRequireNumberField(data.Result, sourceCode || "bsp-upload-stats", "Result", { integer: true })
    });
}

function BSPNormalizeTornStatsSpyPayload(spy, sourceCode) {
    const data = BSPEnsureRecord(spy, sourceCode || "tornstats-spy");
    return {
        timestamp: BSPRequireNumberField(data.timestamp, sourceCode || "tornstats-spy", "timestamp", { min: 0 }),
        strength: BSPRequireNumberField(data.strength, sourceCode || "tornstats-spy", "strength", { min: 0 }),
        speed: BSPRequireNumberField(data.speed, sourceCode || "tornstats-spy", "speed", { min: 0 }),
        defense: BSPRequireNumberField(data.defense, sourceCode || "tornstats-spy", "defense", { min: 0 }),
        dexterity: BSPRequireNumberField(data.dexterity, sourceCode || "tornstats-spy", "dexterity", { min: 0 }),
        total: BSPRequireNumberField(data.total, sourceCode || "tornstats-spy", "total", { min: 0 })
    };
}

function BSPNormalizeYataSpyPayload(spy, sourceCode) {
    const data = BSPEnsureRecord(spy, sourceCode || "yata-spy");
    return {
        total_timestamp: BSPRequireNumberField(data.total_timestamp, sourceCode || "yata-spy", "total_timestamp", { min: 0 }),
        strength: BSPRequireNumberField(data.strength, sourceCode || "yata-spy", "strength", { min: 0 }),
        speed: BSPRequireNumberField(data.speed, sourceCode || "yata-spy", "speed", { min: 0 }),
        defense: BSPRequireNumberField(data.defense, sourceCode || "yata-spy", "defense", { min: 0 }),
        dexterity: BSPRequireNumberField(data.dexterity, sourceCode || "yata-spy", "dexterity", { min: 0 }),
        total: BSPRequireNumberField(data.total, sourceCode || "yata-spy", "total", { min: 0 })
    };
}

function BSPNormalizeCachedPredictionEntry(value, sourceCode) {
    const data = BSPEnsureRecord(value, sourceCode || "prediction-cache");
    const normalized = Object.assign({}, data);
    normalized.CacheSchemaVersion = BSP_CACHE_SCHEMA_VERSION;
    normalized.Result = BSPRequireNumberField(data.Result, sourceCode || "prediction-cache", "Result", { integer: true });

    if (normalized.Result !== FAIL && normalized.Result !== MODEL_ERROR) {
        normalized.TBS = BSPRequireNumberField(data.TBS, sourceCode || "prediction-cache", "TBS", { min: 0 });
        normalized.Score = BSPRequireNumberField(data.Score, sourceCode || "prediction-cache", "Score", { min: 0 });
    } else {
        const tbs = BSPParseNumberish(data.TBS);
        const score = BSPParseNumberish(data.Score);
        if (Number.isFinite(tbs)) normalized.TBS = tbs;
        if (Number.isFinite(score)) normalized.Score = score;
    }

    if (data.DateFetched != undefined) {
        const fetchedDate = new Date(data.DateFetched);
        if (isNaN(fetchedDate.getTime())) {
            throw new Error("Invalid DateFetched in prediction cache");
        }
        normalized.DateFetched = fetchedDate.toISOString();
    } else if (data.PredictionDate != undefined) {
        const predictionDate = new Date(data.PredictionDate);
        if (!isNaN(predictionDate.getTime())) {
            normalized.DateFetched = predictionDate.toISOString();
        }
    }

    return normalized;
}

function BSPNormalizeCachedSpyEntry(value, sourceCode) {
    const data = BSPEnsureRecord(value, sourceCode || "spy-cache");
    const normalized = {
        CacheSchemaVersion: BSP_CACHE_SCHEMA_VERSION,
        timestamp: BSPRequireNumberField(data.timestamp, sourceCode || "spy-cache", "timestamp", { min: 0 }),
        str: BSPRequireNumberField(data.str, sourceCode || "spy-cache", "str", { min: 0 }),
        def: BSPRequireNumberField(data.def, sourceCode || "spy-cache", "def", { min: 0 }),
        spd: BSPRequireNumberField(data.spd, sourceCode || "spy-cache", "spd", { min: 0 }),
        dex: BSPRequireNumberField(data.dex, sourceCode || "spy-cache", "dex", { min: 0 }),
        total: BSPRequireNumberField(data.total, sourceCode || "spy-cache", "total", { min: 0 })
    };

    const nowSeconds = Date.now() / 1000;
    if (normalized.timestamp > nowSeconds + (60 * 60 * 24 * 30)) {
        throw new Error("Spy timestamp is too far in the future");
    }

    return normalized;
}

function BSPGetPredictionDate(prediction) {
    if (!prediction || typeof prediction !== "object") return null;
    const parsed = new Date(prediction.DateFetched || prediction.PredictionDate);
    if (isNaN(parsed.getTime())) return null;
    return parsed;
}

function BSPIsPredictionExpired(prediction) {
    const predictionDate = BSPGetPredictionDate(prediction);
    if (!predictionDate) return true;
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - PREDICTION_VALIDITY_DAYS);
    return predictionDate < expirationDate;
}

function BSPNormalizeColorThresholdEntry(value, fallback, index) {
    const data = BSPEnsureRecord(value, "color-threshold-" + String(index));
    const safeColor = BSPSafeCssColor(data.color, fallback.color);
    const maxValue = BSPRequireNumberField(data.maxValue, "color-threshold-" + String(index), "maxValue", { min: 0 });
    const maxValueScore = BSPRequireNumberField(data.maxValueScore, "color-threshold-" + String(index), "maxValueScore", { min: 0 });
    return {
        maxValue: maxValue,
        maxValueScore: maxValueScore,
        color: safeColor,
        canModify: !!fallback.canModify
    };
}

function BSPReadColorThreshold(index) {
    const fallback = LOCAL_COLORS[index];
    const key = StorageKey.ColorStatsThreshold + index;
    const parsed = BSPStorageGetJson(key, undefined, { errorCode: "invalid-color-threshold-cache" });
    if (parsed == undefined) {
        return Object.assign({}, fallback);
    }
    try {
        return BSPNormalizeColorThresholdEntry(parsed, fallback, index);
    } catch (e) {
        BSPStorageRemove(key);
        BSPLogError("invalid-color-threshold-cache-shape", e, { index: index });
        return Object.assign({}, fallback);
    }
}

function FormatBattleStats(number) {
    var localized = number.toLocaleString('en-US');
    var myArray = localized.split(",");
    if (myArray.length < 1) {
        return 'ERROR';
    }

    var toReturn = myArray[0];
    if (number < 1000) return number;
    if (parseInt(toReturn) < 10) {
        if (parseInt(myArray[1][0]) != 0) {
            toReturn += '.' + myArray[1][0];
        }
    }
    switch (myArray.length) {
        case 2:
            toReturn += "k";
            break;
        case 3:
            toReturn += "m";
            break;
        case 4:
            toReturn += "b";
            break;
        case 5:
            toReturn += "t";
            break;
        case 6:
            toReturn += "q";
            break;
    }

    return toReturn;
}

function IsPage(pageType) {
    let endWith = mapPageAddressEndWith[pageType];
    if (endWith != undefined) {

        return window.location.href.includes(endWith);
    }

    let startWith = mapPageTypeAddress[pageType];
    if (startWith != undefined) {
        return window.location.href.startsWith(startWith);
    }
    return false;
}

function IsUrlEndsWith(value) {
    return window.location.href.endsWith(value);
}

function GetColorMaxValueDifference(ratio) {
    for (var i = 0; i < LOCAL_COLORS.length; ++i) {
        if (ratio < LOCAL_COLORS[i].maxValue) {
            return LOCAL_COLORS[i].color;
        }
    }
    return "#ffc0cb"; //pink
}

function GetColorScoreDifference(ratio) {
    for (var i = 0; i < LOCAL_COLORS.length; ++i) {
        if (ratio < LOCAL_COLORS[i].maxValueScore) {
            return LOCAL_COLORS[i].color;
        }
    }
    return "#ffc0cb"; //pink
}

function IsSubscriptionValid() {

    let subscriptionEnd = GetStorage(StorageKey.DateSubscriptionEnd);
    if (subscriptionEnd == undefined)
        return true;

    var dateNow = new Date();
    var offsetInMinute = dateNow.getTimezoneOffset();
    var dateSubscriptionEnd = new Date(subscriptionEnd);
    dateSubscriptionEnd.setMinutes(dateSubscriptionEnd.getMinutes() - offsetInMinute);
    var time_difference = dateSubscriptionEnd - dateNow;
    return time_difference > 0;
}

function GetColorTheme() {
    let color = GetStorage(StorageKey.BSPColorTheme);
    if (color == undefined) {
        return mainColor;
    }
    let parsed = JSONparse(color);
    if (typeof parsed === "string" && parsed.trim() !== "") {
        return parsed;
    }
    if (/^#[0-9a-fA-F]{3,8}$/.test(String(color))) {
        return String(color);
    }
    BSPLogError("theme-color-invalid", "Invalid stored theme color", { value: String(color || "") });
    return mainColor;
}

function IsNPC(targetID) {
    switch (parseInt(targetID)) {
        case 4:
        case 7:
        case 8:
        case 9:
        case 10:
        case 15:
        case 17:
        case 19:
        case 20:
        case 21:
        case 23:
            return true;
        default:
            return false;
    }
}

// #endregion

// #region Cache

const BSP_CACHE_SCHEMA_VERSION = 1;

const eSetSpyInCacheResult = {
    Error: -1,
    NewSpy: 0,
    SpyUpdated: 1,
    SpyAlreadyThere: 2
};

function GetPredictionFromCache(playerId) {
    var key = StorageKey.BSPPrediction + playerId;

    let raw = BSPStorageGetRaw(key);
    if (raw == "[object Object]") {
        BSPStorageRemove(key);
        raw = undefined;
    }

    if (raw != undefined) {
        let prediction = BSPStorageGetJson(key, undefined, { errorCode: "invalid-prediction-cache" });
        if (prediction == undefined) {
            BSPSetStatus("An invalid BSP cache entry was removed automatically.", "warn", { code: "invalid-prediction-cache" });
            return undefined;
        }
        try {
            prediction = BSPNormalizeCachedPredictionEntry(prediction, "prediction-cache");
        } catch (e) {
            BSPStorageRemove(key);
            BSPLogError("invalid-prediction-cache-shape", e, { playerId: String(playerId || "") });
            BSPSetStatus("An invalid BSP prediction cache entry was removed automatically.", "warn", { code: "invalid-prediction-cache-shape" });
            return undefined;
        }
        return prediction;
    }

    return undefined;
}
function SetPredictionInCache(playerId, prediction) {
    if (prediction.Result == FAIL || prediction.Result == MODEL_ERROR) {
        return;
    }
    var key = StorageKey.BSPPrediction + playerId;
    try {
        const normalized = BSPNormalizeCachedPredictionEntry(
            Object.assign({}, prediction, {
                DateFetched: prediction.DateFetched || new Date().toISOString()
            }),
            "prediction-cache-write"
        );
        BSPStorageSetRaw(key, JSON.stringify(normalized));
    }
    catch (e) {
        BSPLogError("prediction-cache-write-failed", e, { playerId: String(playerId || "") });
        LogInfo("BSP threw an exception in SetPredictionInCache method : " + e);
    }
}
function GetTornStatsSpyFromCache(playerId) {
    let key = StorageKey.TornStatsSpy + playerId;
    let spy = BSPStorageGetJson(key, undefined, { errorCode: "invalid-tornstats-spy-cache" });
    if (spy == undefined) {
        return undefined;
    }
    try {
        spy = BSPNormalizeCachedSpyEntry(spy, "tornstats-spy-cache-read");
    } catch (e) {
        BSPStorageRemove(key);
        BSPLogError("invalid-tornstats-spy-cache-shape", e, { playerId: String(playerId || "") });
        return undefined;
    }
    spy.IsSpy = true;
    spy.Source = "TornStats";
    let hasOneUnknownStat = spy.str == 0 || spy.def == 0 || spy.spd == 0 || spy.dex == 0;
    spy.Score = hasOneUnknownStat ? 0 : parseInt(Math.sqrt(spy.str) + Math.sqrt(spy.def) + Math.sqrt(spy.spd) + Math.sqrt(spy.dex));

    return spy;
}
function SetTornStatsSpyInCache(playerId, spy) {
    if (spy == undefined) {
        return eSetSpyInCacheResult.Error;
    }

    let normalizedSpy;
    try {
        normalizedSpy = BSPNormalizeTornStatsSpyPayload(spy, "tornstats-spy-cache");
    } catch (e) {
        BSPLogError("tornstats-spy-invalid", e, { playerId: String(playerId || "") });
        return eSetSpyInCacheResult.Error;
    }

    let existingSpy = GetTornStatsSpyFromCache(playerId);
    if (existingSpy != undefined && existingSpy.timestamp >= normalizedSpy.timestamp) {
        return eSetSpyInCacheResult.SpyAlreadyThere;
    }

    let objectSpy = new Object();
    objectSpy.CacheSchemaVersion = BSP_CACHE_SCHEMA_VERSION;
    objectSpy.timestamp = normalizedSpy.timestamp;
    objectSpy.str = normalizedSpy.strength;
    objectSpy.spd = normalizedSpy.speed;
    objectSpy.def = normalizedSpy.defense;
    objectSpy.dex = normalizedSpy.dexterity;
    objectSpy.total = normalizedSpy.total;

    var key = StorageKey.TornStatsSpy + playerId;

    try {
        BSPStorageSetRaw(key, JSON.stringify(objectSpy));
    }
    catch (e) {
        BSPLogError("tornstats-cache-write-failed", e, { playerId: String(playerId || "") });
        LogInfo("BSP threw an exception in SetTornStatsSpyInCache method : " + e);
        return eSetSpyInCacheResult.Error;
    }

    if (existingSpy != undefined) {
        return eSetSpyInCacheResult.SpyUpdated;
    }
    else {
        return eSetSpyInCacheResult.NewSpy;
    }
}

function GetSpyFromYataCache(playerId) {
    let key = StorageKey.YataSpy + playerId;
    let spy = BSPStorageGetJson(key, undefined, { errorCode: "invalid-yata-spy-cache" });
    if (spy == undefined) {
        return undefined;
    }
    try {
        spy = BSPNormalizeCachedSpyEntry(spy, "yata-spy-cache-read");
    } catch (e) {
        BSPStorageRemove(key);
        BSPLogError("invalid-yata-spy-cache-shape", e, { playerId: String(playerId || "") });
        return undefined;
    }
    spy.IsSpy = true;
    spy.Source = "YATA";
    let hasOneUnknownStat = spy.str == 0 || spy.def == 0 || spy.spd == 0 || spy.dex == 0;
    spy.Score = hasOneUnknownStat ? 0 : parseInt(Math.sqrt(spy.str) + Math.sqrt(spy.def) + Math.sqrt(spy.spd) + Math.sqrt(spy.dex));
    return spy;
}
function SetYataSpyInCache(playerId, spy) {
    if (spy == undefined) {
        return eSetSpyInCacheResult.Error;
    }

    let normalizedSpy;
    try {
        normalizedSpy = BSPNormalizeYataSpyPayload(spy, "yata-spy-cache");
    } catch (e) {
        BSPLogError("yata-spy-invalid", e, { playerId: String(playerId || "") });
        return eSetSpyInCacheResult.Error;
    }

    let existingYataSpy = GetSpyFromYataCache(playerId);
    if (existingYataSpy != undefined && existingYataSpy.timestamp >= normalizedSpy.total_timestamp) {
        return eSetSpyInCacheResult.SpyAlreadyThere;
    }

    let objectSpy = new Object();
    objectSpy.CacheSchemaVersion = BSP_CACHE_SCHEMA_VERSION;
    objectSpy.timestamp = normalizedSpy.total_timestamp;
    objectSpy.str = normalizedSpy.strength;
    objectSpy.spd = normalizedSpy.speed;
    objectSpy.def = normalizedSpy.defense;
    objectSpy.dex = normalizedSpy.dexterity;
    objectSpy.total = normalizedSpy.total;

    var key = StorageKey.YataSpy + playerId;
    try {
        BSPStorageSetRaw(key, JSON.stringify(objectSpy));
    }
    catch (e) {
        BSPLogError("yata-cache-write-failed", e, { playerId: String(playerId || "") });
        LogInfo("BSP threw an exception in SetYataSpyInCache method : " + e);
        return eSetSpyInCacheResult.Error;
    }

    if (existingYataSpy != undefined) {
        return eSetSpyInCacheResult.SpyUpdated;
    }
    else {
        return eSetSpyInCacheResult.NewSpy;
    }
}

function GetMostRecentSpyFromCache(playerId) {
    let tornStatsSpy = GetTornStatsSpyFromCache(playerId);
    let yataSpy = GetSpyFromYataCache(playerId);
    if (tornStatsSpy == undefined && yataSpy == undefined) {
        return undefined;
    }

    if (tornStatsSpy == undefined) {
        return yataSpy;
    }

    if (yataSpy == undefined) {
        return tornStatsSpy;
    }

    return yataSpy.timestamp >= tornStatsSpy.timestamp ? yataSpy : tornStatsSpy;
}

const eStorageType = {
    All_BSP: 'All_BSP',
    Prediction: 'Prediction',
    TornStatsSpies: 'TornStatsSpies',
    YATASpies: 'YATASpies',
    ALL_ExceptBSP: 'ALL_ExceptBSP',
    TornChat: 'TornChat'
};

function GetPredictionStorage(storageType) {
    let prefix = "";
    switch (storageType) {
        case eStorageType.All_BSP:
        case eStorageType.ALL_ExceptBSP:
            {
                prefix = BSP_STORAGE_PREFIX;
                break;
            }
        case eStorageType.Prediction:
            {
                prefix = StorageKey.BSPPrediction;
                break;
            }
        case eStorageType.TornStatsSpies:
            {
                prefix = StorageKey.TornStatsSpy;
                break;
            }
        case eStorageType.YATASpies:
            {
                prefix = StorageKey.YataSpy;
                break;
            }
        case eStorageType.TornChat:
            {
                prefix = "chat:";
                break;
            }
        default:
            return undefined;
    }

    let itemNb = 0;
    let toReturn = "";
    const storageKeys = BSPStorageKeys();
    for (let i = 0; i < storageKeys.length; i++) {
        let key = storageKeys[i];

        if (storageType == eStorageType.ALL_ExceptBSP) {
            if (!key.startsWith(prefix)) {
                toReturn += BSPStorageGetRaw(key) + "\r\n";
                itemNb++;
            }
        }
        else if (key.startsWith(prefix)) {
            toReturn += BSPStorageGetRaw(key) + "\r\n";
            itemNb++;
        }
    }
    // Create a blog object with the file content which you want to add to the file
    const file = new Blob([toReturn], { type: 'text/plain' });
    return [itemNb, file.size];
}

function ClearCache(storageType) {
    let prefix = "";
    switch (storageType) {
        case eStorageType.All_BSP:
            {
                prefix = BSP_STORAGE_PREFIX;
                break;
            }
        case eStorageType.Prediction:
            {
                prefix = StorageKey.BSPPrediction;
                break;
            }
        case eStorageType.TornStatsSpies:
            {
                prefix = StorageKey.TornStatsSpy;
                break;
            }
        case eStorageType.YATASpies:
            {
                prefix = StorageKey.YataSpy;
                break;
            }
        case eStorageType.TornChat:
            {
                prefix = "chat:";
                break;
            }
        default:
            return;
    }

    const storageKeys = BSPStorageKeys();
    for (let i = 0; i < storageKeys.length; i++) {
        let key = storageKeys[i];
        if (storageType == eStorageType.ALL_ExceptBSP) {
            if (!key.startsWith(prefix)) {
                BSPStorageRemove(key);
            }
        }
        else if (key.startsWith(prefix)) {
            BSPStorageRemove(key);
        }

        if (storageType == eStorageType.TornStatsSpies) {
            if (key.startsWith(StorageKey.AutoImportLastDatePlayer) || key.startsWith(StorageKey.AutoImportLastDateFaction)) {
                BSPStorageRemove(key);
            }
        }
    }
}

function ExportPredictorStorage() {
    let toReturn = "";
    const storageKeys = BSPStorageKeys();
    for (let i = 0; i < storageKeys.length; i++) {
        let key = storageKeys[i];
        if (BSPStorageIsManagedKey(key)) {
            toReturn += BSPStorageGetRaw(key) + "\r\n";
        }
    }

    // Create element with <a> tag
    const link = document.createElement("a");

    // Create a blog object with the file content which you want to add to the file
    const file = new Blob([toReturn], { type: 'text/plain' });

    // Add file content in the object URL
    link.href = URL.createObjectURL(file);

    // Add file name
    link.download = "bsp_full_localstorage.txt";

    // Add click event to <a> tag to save file.
    link.click();
    URL.revokeObjectURL(link.href);
}

function TestLocalStorage() {
    try {
        var textToStore = 'This is a test to detect if there is enough space in the localstorage.';
        textToStore += 'Its written, then deleted right away, when the BSP player clicks on a debug button.The Goal is to troubleshoot easily this issue when it happens.Making it long enough for proper testing.';
        textToStore += 'Its written, then deleted right away, when the BSP player clicks on a debug button.The Goal is to troubleshoot easily this issue when it happens.Making it long enough for proper testing.';
        textToStore += 'Its written, then deleted right away, when the BSP player clicks on a debug button.The Goal is to troubleshoot easily this issue when it happens.Making it long enough for proper testing.';
        textToStore += 'Its written, then deleted right away, when the BSP player clicks on a debug button.The Goal is to troubleshoot easily this issue when it happens.Making it long enough for proper testing.';

        BSPStorageSetRaw(StorageKey.TestLocalStorageKey, textToStore);
        BSPStorageRemove(StorageKey.TestLocalStorageKey);
        return true;
    }
    catch (e) {
        BSPLogError("localstorage-test-failed", e, null);
        LogInfo("BSP threw an exception in SetStorage method : " + e);
        return false;
    }
}

function ClearOutdatedPredictionInCache() {
    let lastDateAutoClearOutdatedCache = GetStorage(StorageKey.AutoClearOutdatedCacheLastDate);
    if (lastDateAutoClearOutdatedCache != undefined) {
        let dateConsideredTooOld = new Date();
        dateConsideredTooOld.setDate(dateConsideredTooOld.getDate() - PREDICTION_VALIDITY_DAYS);
        if (new Date(lastDateAutoClearOutdatedCache) > dateConsideredTooOld) {
            return;
        }
    }

    let numberOfPredictionCleared = 0;
    const storageKeys = BSPStorageKeys();
    for (let i = 0; i < storageKeys.length; i++) {
        let key = storageKeys[i];
        if (key.startsWith(StorageKey.BSPPrediction)) {
            let prediction = BSPStorageGetJson(key, undefined, { errorCode: "invalid-prediction-cache-autoclear" });
            if (prediction == undefined) {
                BSPStorageRemove(key);
                numberOfPredictionCleared++;
                continue;
            }
            try {
                prediction = BSPNormalizeCachedPredictionEntry(prediction, "prediction-cache-autoclear");
                if (BSPIsPredictionExpired(prediction)) {
                    BSPStorageRemove(key);
                    numberOfPredictionCleared++;
                }
            } catch (_) {
                BSPStorageRemove(key);
                numberOfPredictionCleared++;
            }
        }
    }

    if (numberOfPredictionCleared > 0) {
        LogInfo(numberOfPredictionCleared + " outdated predictions have been cleared from the local cache");
    }

    SetStorage(StorageKey.AutoClearOutdatedCacheLastDate, new Date());
}

function ClearOutdatedSpiesInCache() {
    let lastDateAutoClearOutdatedSpyCache = GetStorage(StorageKey.AutoClearOutdatedSpyCacheLastDate);
    if (lastDateAutoClearOutdatedSpyCache != undefined) {
        let dateConsideredTooRecent = new Date();
        dateConsideredTooRecent.setDate(dateConsideredTooRecent.getDate() - 1);
        if (new Date(lastDateAutoClearOutdatedSpyCache) > dateConsideredTooRecent) {
            return;
        }
    }

    let expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - SPY_CACHE_VALIDITY_DAYS);
    let numberOfSpiesCleared = 0;

    const storageKeys = BSPStorageKeys();
    for (let i = 0; i < storageKeys.length; i++) {
        const key = storageKeys[i];
        const isSpyKey = key.startsWith(StorageKey.TornStatsSpy) || key.startsWith(StorageKey.YataSpy);
        if (!isSpyKey) continue;

        const cachedSpy = BSPStorageGetJson(key, undefined, { errorCode: "invalid-spy-cache-autoclear" });
        if (cachedSpy == undefined) {
            BSPStorageRemove(key);
            numberOfSpiesCleared++;
            continue;
        }

        let normalizedSpy;
        try {
            normalizedSpy = BSPNormalizeCachedSpyEntry(cachedSpy, "spy-cache-autoclear");
        } catch (_) {
            BSPStorageRemove(key);
            numberOfSpiesCleared++;
            continue;
        }

        const spyDate = new Date(normalizedSpy.timestamp * 1000);
        if (isNaN(spyDate.getTime()) || spyDate < expirationDate) {
            BSPStorageRemove(key);
            numberOfSpiesCleared++;
        }
    }

    if (numberOfSpiesCleared > 0) {
        LogInfo(numberOfSpiesCleared + " outdated spies have been cleared from the local cache");
    }

    SetStorage(StorageKey.AutoClearOutdatedSpyCacheLastDate, new Date());
}

function AutoImportStats() {
    // Automatic import stats

    if (GetStorageBool(StorageKey.IsAutoImportStats) == true) {
        let dateConsideredTooOld = new Date();
        dateConsideredTooOld.setDate(dateConsideredTooOld.getDate() - 1);

        let lastDateAutoImportStats = GetStorage(StorageKey.AutoImportStatsLastDate);
        if (lastDateAutoImportStats != undefined) {
            let lastDateAutoImportStatsDate = new Date(lastDateAutoImportStats);
            if (lastDateAutoImportStatsDate > dateConsideredTooOld) {
                return;
            }
        }

        SetStorage(StorageKey.AutoImportStatsLastDate, new Date());
        GetPlayerStatsFromTornAPI();
    }
}

// #endregion

// #region Get Data for Player

async function GetPredictionForPlayer(targetId, callback) {
    if (targetId == undefined || targetId < 1) return;
    if (IsNPC(targetId) == true) return;

    let targetSpy = GetMostRecentSpyFromCache(targetId);
    if (targetSpy != undefined && targetSpy.total != undefined && targetSpy.total != 0) {
        let spyDateConsideredTooOld = new Date();
        let daysToUseSpies = BSPStorageGetInt(StorageKey.DaysToUseSpies, 30);
        if (!Number.isFinite(daysToUseSpies) || daysToUseSpies < 1) daysToUseSpies = 30;
        spyDateConsideredTooOld.setDate(spyDateConsideredTooOld.getDate() - daysToUseSpies);
        let spyDate = new Date(targetSpy.timestamp * 1000);
        if (spyDate > spyDateConsideredTooOld) {
            BSPInvokeCallback(callback, [targetId, targetSpy], "prediction-target-spy");
            return;
        }
    }

    var prediction = GetPredictionFromCache(targetId);
    if (prediction != undefined) {
        var isPredictionValid = true;
        if (BSPIsPredictionExpired(prediction)) {
            var key = StorageKey.BSPPrediction + targetId;
            BSPStorageRemove(key);
            isPredictionValid = false;
        }

        if (isPredictionValid) {
            prediction.fromCache = true;

            if (targetSpy != undefined) {
                prediction.attachedSpy = targetSpy;
            }
            BSPInvokeCallback(callback, [targetId, prediction], "prediction-from-cache");
            //LogInfo("Prediction for target " + targetId + " found in the cache!");
            return;
        }
    }

    LogInfo("Prediction for target " + targetId + " not found in the cache, querying BSP server..");
    const newPrediction = await FetchScoreAndTBS(targetId);
    LogInfo("Prediction for target " + targetId + " not found in the cache, value retrieved from BSP server!");
    if (newPrediction != undefined) {
        newPrediction.DateFetched = new Date().toISOString(); // Keep a trace of the local date when the prediction was fetched, so we don't fetch it again every time (PREDICTION_VALIDITY_DAYS)
        SetPredictionInCache(targetId, newPrediction);
    }

    if (targetSpy != undefined && newPrediction != undefined) {
        newPrediction.attachedSpy = targetSpy;
    }
    BSPInvokeCallback(callback, [targetId, newPrediction], "prediction-fresh");
}

// #endregion

// #region Callback

function GetConsolidatedDataForPlayerStats(prediction) {
    let objectToReturn = new Object();
    objectToReturn.IsUsingSpy = prediction.IsSpy === true;
    objectToReturn.TargetTBS = 0;
    objectToReturn.Score = 0;
    objectToReturn.Success = SUCCESS;
    objectToReturn.OldSpyStrongerThanPrediction = false;
    objectToReturn.Spy = undefined;
    objectToReturn.IsHOF = false;
    objectToReturn.isFFAttacks = false;

    let isUsingSpy = prediction.IsSpy === true;
    if (isUsingSpy) {
        objectToReturn.TargetTBS = prediction.total;
        objectToReturn.Score = prediction.Score;
        objectToReturn.Spy = prediction;
    }
    else {
        objectToReturn.Success = prediction.Result;

        switch (prediction.Result) {
            case FAIL:
            case MODEL_ERROR:
                return objectToReturn;
            case TOO_WEAK:
            case TOO_STRONG:
            case HOF:
            case FFATTACKS:
            case SUCCESS:
            default:
                {
                    let intTBS = BSPParseNumberish(prediction.TBS);
                    if (!Number.isFinite(intTBS)) {
                        BSPLogError("prediction-tbs-invalid", "Invalid TBS in consolidated data", { value: String(prediction.TBS || "") });
                        intTBS = 0;
                    }
                    objectToReturn.TargetTBS = intTBS;

                    if (prediction.Result == HOF) {
                        objectToReturn.IsHOF = true;
                    }

                    if (prediction.Result == FFATTACKS) {
                        objectToReturn.isFFAttacks = true;
                    }

                    objectToReturn.Score = BSPParseNumberish(prediction.Score);
                    if (!Number.isFinite(objectToReturn.Score)) {
                        BSPLogError("prediction-score-invalid", "Invalid score in consolidated data", { value: String(prediction.Score || "") });
                        objectToReturn.Score = 0;
                    }

                    if (prediction.attachedSpy != undefined) {
                        if (prediction.attachedSpy.total > 0 && prediction.attachedSpy.total > objectToReturn.TargetTBS) {
                            objectToReturn.TargetTBS = prediction.attachedSpy.total;
                            objectToReturn.OldSpyStrongerThanPrediction = true;
                            objectToReturn.Spy = prediction.attachedSpy;
                        }
                    }

                    break;
                }
        }
    }

    return objectToReturn;
}

function OpenAttackScreenForPlayerId(playerId) {
    var urlAttack = URL_TORN_ATTACK + playerId;
    if (GetStorageBoolWithDefaultValue(StorageKey.ShouldOpenAttackURLInNewTab, true)) {
        window.open(urlAttack, '_blank');
    }
    else {
        window.open(urlAttack);
    }
}

var divStats = undefined;
var isDivStatsCreated = false;
function OnProfilePlayerStatsRetrieved(playerId, prediction) {
    if (prediction == undefined)
        return;

    if (prediction.timestamp != undefined) {
        let spyDateConsideredTooOld = new Date();
        let daysToUseSpies = BSPStorageGetInt(StorageKey.DaysToUseSpies, 30);
        if (!Number.isFinite(daysToUseSpies) || daysToUseSpies < 1) daysToUseSpies = 30;

        spyDateConsideredTooOld.setDate(spyDateConsideredTooOld.getDate() - daysToUseSpies);
        let spyDate = new Date(prediction.timestamp * 1000);
        if (spyDate < spyDateConsideredTooOld) {
            return;
        }
    }

    let localBattleStats = GetLocalBattleStats();
    let localTBS = localBattleStats.TBS;
    let consolidatedData = GetConsolidatedDataForPlayerStats(prediction);

    let tbsRatio = 100 * consolidatedData.TargetTBS / localTBS;
    let colorComparedToUs = GetColorMaxValueDifference(tbsRatio);

    let ScoreRatio = 0;

    if (consolidatedData.Success != FAIL && consolidatedData.Success != MODEL_ERROR && GetStorageBool(StorageKey.IsShowingBattleStatsScore) == true) {
        ScoreRatio = 100 * consolidatedData.Score / localBattleStats.Score;
        colorComparedToUs = GetColorScoreDifference(ScoreRatio);
    }

    let FFPredicted2 = Math.min(1 + (8 / 3) * (consolidatedData.Score / localBattleStats.Score), 3);
    FFPredicted2 = Math.max(1, FFPredicted2);
    FFPredicted2 = FFPredicted2.toFixed(2);

    let imgType = mainBSPIcon;
    let extraIndicatorSrc = "";

    prediction.PredictionDate = BSPGetPredictionDate(prediction);

    if (prediction.IsSpy) {
        prediction.PredictionDate = new Date(prediction.timestamp * 1000);
        if (prediction.Source == "TornStats") {
            imgType = tornstatsIcon;
        }
        else if (prediction.Source == "YATA") {
            imgType = yataIcon;
        }

        extraIndicatorSrc = starIcon;
    }

    if (consolidatedData != undefined) {
        if (consolidatedData.IsHOF) {
            imgType = "https://i.ibb.co/x55qnBr/HOF-Long.png";
            extraIndicatorSrc = hofIcon;
            if (consolidatedData.Spy != undefined) {
                prediction.PredictionDate = new Date(consolidatedData.Spy.timestamp * 1000);
            }
        }
        else if (consolidatedData.isFFAttacks) {
            extraIndicatorSrc = FFAttacksIcon;
        }
        else if (consolidatedData.OldSpyStrongerThanPrediction) {
            extraIndicatorSrc = oldSpyIcon;
            if (consolidatedData.Spy != undefined) {
                prediction.PredictionDate = new Date(consolidatedData.Spy.timestamp * 1000);
                if (consolidatedData.Spy.Source == "TornStats") {
                    imgType = tornstatsIcon;
                }
                else if (consolidatedData.Spy.Source == "YATA") {
                    imgType = yataIcon;
                }
            }
        }
    }

    if (!(prediction.PredictionDate instanceof Date) || isNaN(prediction.PredictionDate.getTime())) {
        prediction.PredictionDate = new Date();
    }
    var relativeTime = FormatRelativeTime(prediction.PredictionDate);

    if (!isDivStatsCreated) {
        divStats = document.createElement("div");
        isDivStatsCreated = true;

        if (GetStorageBoolWithDefaultValue(StorageKey.IsClickingOnProfileStatsAttackPlayer)) {
            divStats.addEventListener('click', function () {
                OpenAttackScreenForPlayerId(playerId);
            });
        }

        if (GetStorageBoolWithDefaultValue(StorageKey.IsShowingAlternativeProfileDisplay, false)) {
            var referenceNode = PlayerProfileDivWhereToInject.firstChild.childNodes[1];
            PlayerProfileDivWhereToInject.firstChild.insertBefore(divStats, referenceNode);
        }
        else {
            PlayerProfileDivWhereToInject.appendChild(divStats);
        }
    }

    let isShowingBScore = GetStorageBool(StorageKey.IsShowingBattleStatsScore);
    divStats.textContent = "";

    if (extraIndicatorSrc) {
        var profileIndicator = BSPCreateIndicatorImage(extraIndicatorSrc, "18px", "18px", "-10px -10px");
        if (profileIndicator) {
            divStats.appendChild(profileIndicator);
        }
    }

    var table = document.createElement("table");
    table.style.width = "100%";
    table.style.fontFamily = "initial";

    if (GetStorageBoolWithDefaultValue(StorageKey.IsShowingStatsHeader, true)) {
        var headerRow = document.createElement("tr");
        headerRow.style.fontSize = "small";
        headerRow.style.color = "white";
        headerRow.style.backgroundColor = "#344556";

        var headerTexts = [isShowingBScore ? "BScore" : "TBS", " % You", " FF", " Source", " Date "];
        for (let h = 0; h < headerTexts.length; h++) {
            var th = document.createElement("th");
            th.style.border = "1px solid gray";
            th.textContent = headerTexts[h];
            headerRow.appendChild(th);
        }

        table.appendChild(headerRow);
    }

    var dataRow = document.createElement("tr");
    dataRow.style.fontSize = "x-large";
    dataRow.style.backgroundColor = BSPSafeCssColor(colorComparedToUs, "pink");

    var valueCell = document.createElement("td");
    valueCell.style.verticalAlign = "middle";
    valueCell.style.fontWeight = "600";
    valueCell.style.textAlign = "center";
    valueCell.style.border = "1px solid gray";
    valueCell.textContent = String(FormatBattleStats(isShowingBScore ? consolidatedData.Score : consolidatedData.TargetTBS));
    dataRow.appendChild(valueCell);

    var ratioCell = document.createElement("td");
    ratioCell.style.verticalAlign = "middle";
    ratioCell.style.fontWeight = "600";
    ratioCell.style.textAlign = "center";
    ratioCell.style.border = "1px solid gray";
    ratioCell.textContent = String(parseInt(isShowingBScore ? ScoreRatio : tbsRatio)) + "%";
    dataRow.appendChild(ratioCell);

    var ffCell = document.createElement("td");
    ffCell.style.verticalAlign = "middle";
    ffCell.style.fontWeight = "600";
    ffCell.style.textAlign = "center";
    ffCell.style.border = "1px solid gray";
    ffCell.textContent = String(FFPredicted2);
    dataRow.appendChild(ffCell);

    var sourceCell = document.createElement("td");
    sourceCell.style.verticalAlign = "middle";
    sourceCell.style.border = "1px solid gray";
    sourceCell.style.textAlign = "center";
    sourceCell.style.backgroundColor = "#344556";
    var sourceImg = document.createElement("img");
    sourceImg.src = imgType;
    sourceImg.style.maxWidth = "100px";
    sourceImg.style.maxHeight = "30px";
    sourceCell.appendChild(sourceImg);
    dataRow.appendChild(sourceCell);

    var dateCell = document.createElement("td");
    dateCell.style.verticalAlign = "middle";
    dateCell.style.textAlign = "center";
    dateCell.style.border = "1px solid gray";
    dateCell.style.fontSize = "medium";
    dateCell.style.backgroundColor = "#344556";
    dateCell.style.color = "white";
    dateCell.textContent = String(relativeTime);
    dataRow.appendChild(dateCell);

    table.appendChild(dataRow);
    divStats.appendChild(table);
}

function ConvertLocalDateToUTCIgnoringTimezone(date) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(),
        date.getUTCDate(), date.getUTCHours(),
        date.getUTCMinutes(), date.getUTCSeconds());
}

function DateUTCNow() {
    let now = new Date();
    return ConvertLocalDateToUTCIgnoringTimezone(now);
}

function FormatRelativeTime(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        return "Unknown";
    }

    let dateNow = new Date();
    let diff = Math.round((dateNow - date) / 1000);

    if (diff < 60) {
        return 'Seconds ago';
    } else if (diff < 3600) {
        var minutes = Math.floor(diff / 60);
        return minutes + ' minute' + (minutes > 1 ? 's' : '') + ' ago';
    } else if (diff < 86400) {
        var hours = Math.floor(diff / 3600);
        return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
    } else if (diff < 86400 * 24 * 365) {
        var days = Math.floor(diff / (3600 * 24));
        return days + ' day' + (days > 1 ? 's' : '') + ' ago';
    } else if (diff < 86400 * 24 * 365 * 15) {
        var years = Math.floor(diff / (3600 * 24 * 365));
        return years + ' year' + (years > 1 ? 's' : '') + ' ago';
    }
    else {
        return date.toLocaleString();
    }
}

function IsThereMyNodeAlready(node, urlAttack) {
    // Base case: if the node is null, stop the recursion
    if (!node) {
        return false;
    }

    // Check if the current node has the specified class name
    if (node.className === "TDup_ColoredStatsInjectionDiv") {
        return true;
    }

    // Check if the inner HTML of the current node starts with the specified URL
    if (node.href != undefined && node.href.startsWith(urlAttack)) {
        return true;
    }

    // Recursively process child nodes
    for (let i = 0; i < node.childNodes.length; i++) {
        const childNode = node.childNodes[i];
        let result = IsThereMyNodeAlready(childNode, urlAttack);
        if (result) {
            return true;
        }
    }
    return false;
}

function OnPlayerStatsRetrievedForGrid(targetId, prediction) {
    var urlAttack = URL_TORN_ATTACK + targetId;
    let isShowingHonorBars = GetStorageBoolWithDefaultValue(StorageKey.IsShowingHonorBars, true);
    let spyMargin = '-6px 23px';
    let mainMarginWhenDisplayingHonorBars = "-10px -9px";

    if (IsPage(PageType.FactionControl)) {
        if (IsPage(PageType.FactionControlPayday)) {
            mainMarginWhenDisplayingHonorBars = '-25px 20px';
            spyMargin = '-3px 12px';
        }
        else if (IsPage(PageType.FactionControlApplications)) {
            mainMarginWhenDisplayingHonorBars = '-10px 0px';
            spyMargin = '-5px 23px';
        }
        else {
            mainMarginWhenDisplayingHonorBars = '0px';
            spyMargin = '-5px 23px';
        }
    }
    else if (IsPage(PageType.Chain) && !isShowingHonorBars) {
        spyMargin = '-1px 23px';
    }
    else if (IsPage(PageType.Faction)) {
        if (isShowingHonorBars) {
            spyMargin = '-16px 15px';
        }
        else if (IsUrlEndsWith('/war/rank')) {
            spyMargin = '0px 23px';
        }
    }
    else if (IsPage(PageType.HallOfFame) && isShowingHonorBars) {
        mainMarginWhenDisplayingHonorBars = "-10px -9px";
        spyMargin = '-16px 17px';
    }
    else if (IsPage(PageType.Search) && isShowingHonorBars) {
        mainMarginWhenDisplayingHonorBars = '6px -8px';
    }
    else if (IsPage(PageType.Company) && isShowingHonorBars) {
        mainMarginWhenDisplayingHonorBars = '0px';
    }
    else if (IsPage(PageType.RecruitCitizens) && isShowingHonorBars) {
        mainMarginWhenDisplayingHonorBars = '0px';
    }
    else if (IsPage(PageType.Friends) || IsPage(PageType.Enemies) || IsPage(PageType.Targets)) {
        spyMargin = '-5px 23px';
        if (isShowingHonorBars) {
            mainMarginWhenDisplayingHonorBars = '-10px 0px';
            spyMargin = '-14px 23px';
        }
    }
    else if (IsPage(PageType.PointMarket) && isShowingHonorBars) {
        mainMarginWhenDisplayingHonorBars = '5px -5px';
    }
    else if (IsPage(PageType.Market) && isShowingHonorBars) {
        mainMarginWhenDisplayingHonorBars = '-10px -10px';
        spyMargin = '-18px 13px';
    }
    else if (IsPage(PageType.Hospital) && isShowingHonorBars) {
        mainMarginWhenDisplayingHonorBars = '0px 6px';
    }
    else if (IsPage(PageType.Abroad)) {
        spyMargin = '0px 20px';
        if (isShowingHonorBars) {
            mainMarginWhenDisplayingHonorBars = '5px -4px';
        }
        else {
            spyMargin = '0px 23px';
        }
    }
    else if (IsPage(PageType.Forum)) {
        spyMargin = '0px 23px';
        if (isShowingHonorBars) {
            mainMarginWhenDisplayingHonorBars = '7px 0px';
            if (IsPage(PageType.ForumThread) || IsPage(PageType.ForumSearch)) {
                spyMargin = '-5px 15px';
                mainMarginWhenDisplayingHonorBars = '-26px 28px';
            }
        }
    }
    else if (IsPage(PageType.Bounty)) {
        isShowingHonorBars = false; // No honor bars in bounty page, ever.
        spyMargin = '1px 24px';
    }
    else if (IsPage(PageType.Properties)) {
        mainMarginWhenDisplayingHonorBars = '0px';
        if (isShowingHonorBars) {
            spyMargin = '-6px 15px';
        }
    }
    else if (IsPage(PageType.War)) {
        spyMargin = isShowingHonorBars ? '-16px 15px' : '-4px 24px';
    }
    else if (IsPage(PageType.Competition) && isShowingHonorBars) {
        if (window.location.href.startsWith("https://www.torn.com/competition.php#/p=revenge")) {
            mainMarginWhenDisplayingHonorBars = '0px 0px';
        }
        else {
            mainMarginWhenDisplayingHonorBars = '10px 0px';
        }
    }
    else if (IsPage(PageType.Elimination) && isShowingHonorBars) {
        if (IsPage(PageType.EliminationAttacks)) {
            mainMarginWhenDisplayingHonorBars = '-11px -100px';
            spyMargin = '-18px -75px';
        }
        else {
            mainMarginWhenDisplayingHonorBars = '-11px 0px';
            spyMargin = '-18px 23px';
        }

    }
    else if (IsPage(PageType.RussianRoulette)) {
        if (isShowingHonorBars) {
            spyMargin = '-14px 15px';
        }
    }

    let consolidatedData = GetConsolidatedDataForPlayerStats(prediction);
    let localBattleStats = GetLocalBattleStats();

    let colorComparedToUs;
    let formattedBattleStats;
    let FFPredicted = 0;

    let showScoreInstead = GetStorageBool(StorageKey.IsShowingBattleStatsScore);
    if (showScoreInstead == true) {
        let scoreRatio = 100 * consolidatedData.Score / localBattleStats.Score;
        colorComparedToUs = GetColorScoreDifference(scoreRatio);
        if (GetStorageBool(StorageKey.IsShowingBattleStatsPercentage)) {
            let ratioToDisplay = Math.min(999, scoreRatio);
            formattedBattleStats = ratioToDisplay.toFixed(0) + "%";
        }
        else {
            formattedBattleStats = FormatBattleStats(consolidatedData.Score);
        }

        FFPredicted = Math.min(1 + (8 / 3) * (consolidatedData.Score / localBattleStats.Score), 3);
        FFPredicted = FFPredicted.toFixed(2);
    }
    else {
        let tbsRatio = 100 * consolidatedData.TargetTBS / localBattleStats.TBS;
        colorComparedToUs = GetColorMaxValueDifference(tbsRatio);

        if (GetStorageBool(StorageKey.IsShowingBattleStatsPercentage)) {
            let ratioToDisplay = Math.min(999, tbsRatio);
            formattedBattleStats = ratioToDisplay.toFixed(0) + "%";
        }
        else {
            formattedBattleStats = FormatBattleStats(consolidatedData.TargetTBS);
        }
    }

    if (consolidatedData.Success == FAIL) {
        colorComparedToUs = "pink";
        formattedBattleStats = "Wait";
    } else if (consolidatedData.Success == MODEL_ERROR) {
        colorComparedToUs = "pink";
        formattedBattleStats = "Error";
    }

    for (let i = 0; i < dictDivPerPlayer[targetId].length; i++) {

        if (IsThereMyNodeAlready(dictDivPerPlayer[targetId][i], urlAttack)) {
            continue;
        }

        let isWall = IsPage(PageType.Faction) && !IsPage(PageType.FactionControl) && dictDivPerPlayer[targetId][i].className == "user name ";
        if (isWall) {
            //WALL display
            if (isShowingHonorBars) {
                mainMarginWhenDisplayingHonorBars = "-28px 54px";
                spyMargin = '0px 23px';
            }
            else {
                spyMargin = '3px 23px';
            }
        }

        if (IsPage(PageType.Competition) && isShowingHonorBars) {
            if (window.location.href.startsWith("https://www.torn.com/competition.php#/p=recent")) {
                if (HasParentWithClass(dictDivPerPlayer[targetId][i], "name lost")) {
                    mainMarginWhenDisplayingHonorBars = "12px 0px";
                }
                else if (HasParentWithClass(dictDivPerPlayer[targetId][i], "name right")) {
                    mainMarginWhenDisplayingHonorBars = "0px 0px";
                }
            }
        }

        let statsToSort = showScoreInstead ? consolidatedData.Score : consolidatedData.TargetTBS;
        let indicatorSrc = "";
        let titleText = '';
        if (consolidatedData.IsUsingSpy) {
            let FFPredicted = Math.min(1 + (8 / 3) * (consolidatedData.Score / localBattleStats.Score), 3);
            FFPredicted = Math.max(1, FFPredicted);
            FFPredicted = FFPredicted.toFixed(2);

            indicatorSrc = starIcon;
            titleText = 'Data coming from spy (' + String(consolidatedData.Spy.Source || "") + ') FF : ' + FFPredicted + ' ';
        }
        else if (consolidatedData.IsHOF) {
            indicatorSrc = hofIcon;
            titleText = "Stats coming from the Top 100 HOF forum thread";
        }
        else if (consolidatedData.isFFAttacks) {
            indicatorSrc = FFAttacksIcon;
            titleText = "Stats coming from BSP users attacks";
        }
        else if (consolidatedData.OldSpyStrongerThanPrediction) {
            indicatorSrc = oldSpyIcon;
            titleText = "Old spy having greater TBS than prediction -> showing old spy data instead";
        }
        else if (showScoreInstead) {
            titleText = "FF Predicted = " + FFPredicted;
        }

        let shouldOpenAttackNewTab = GetStorageBoolWithDefaultValue(StorageKey.ShouldOpenAttackURLInNewTab, true);
        let statsBadgeLink = BSPCreateStatsBadgeLink(
            urlAttack,
            shouldOpenAttackNewTab,
            indicatorSrc,
            spyMargin,
            isShowingHonorBars,
            mainMarginWhenDisplayingHonorBars,
            statsToSort,
            titleText,
            colorComparedToUs,
            formattedBattleStats
        );

        if (!isShowingHonorBars && IsPage(PageType.War) && !IsPage(PageType.ChainReport) && !IsPage(PageType.RWReport)) {
            dictDivPerPlayer[targetId][i].style.position = "absolute";
        }

        if (GetStorageBoolWithDefaultValue(StorageKey.IsShowingHonorBars, true) && !IsPage(PageType.Bounty)) {
            let coloredStatsInjectionDiv = document.createElement("div");
            coloredStatsInjectionDiv.className = "TDup_ColoredStatsInjectionDiv";
            coloredStatsInjectionDiv.appendChild(statsBadgeLink);
            BSPPrependNode(dictDivPerPlayer[targetId][i], coloredStatsInjectionDiv);
        }
        else {
            if (IsPage(PageType.Elimination) && !IsPage(PageType.EliminationRevenge)) {
                let coloredStatsInjectionDiv = document.createElement("div");
                coloredStatsInjectionDiv.className = "TDup_ColoredStatsInjectionDivWithoutHonorBar";
                coloredStatsInjectionDiv.appendChild(statsBadgeLink);
                BSPPrependNode(dictDivPerPlayer[targetId][i], coloredStatsInjectionDiv);
            }
            else {
                BSPPrependNode(dictDivPerPlayer[targetId][i], statsBadgeLink);
            }
        }
    }
}

function HasParentWithClass(element, className) {
    let parent = element.parentElement;

    while (parent) {
        if (parent.classList.value.startsWith(className)) {
            return true;
        }
        parent = parent.parentElement;
    }

    return false;
}

// #endregion

// #region Option Menus

function OpenOptionsTab(evt, optionsTabName) {
    var tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("TDup_optionsTabContent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("TDup_tablinks");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(optionsTabName).style.display = "block";
    evt.currentTarget.className += " active";
}

function BuildOptionMenu(menuArea, contentArea, name, shouldBeHiddenWhenInactive, isOpenAtStart = false) {
    // Adding the button in the tabs
    let TabEntryBtn = document.createElement("button");
    TabEntryBtn.className = "TDup_tablinks";
    if (shouldBeHiddenWhenInactive == true)
        TabEntryBtn.className += " TDup_tablinksShouldBeHiddenWhenInactive";

    if (isOpenAtStart)
        TabEntryBtn.id = "TDup_tablinks_defaultOpen";

    TabEntryBtn.textContent = String(name || "");
    TabEntryBtn.addEventListener("click", function (evt) {
        OpenOptionsTab(evt, "TDup_optionsTabContent_" + name);
    });

    menuArea.appendChild(TabEntryBtn);

    // Adding the corresponding div
    let TabContent = document.createElement("div");
    TabContent.className = "TDup_optionsTabContent";
    TabContent.id = "TDup_optionsTabContent_" + name;
    contentArea.appendChild(TabContent);

    return TabContent;
}

function BuildOptionMenu_Global(tabs, menu) {
    let contentDiv = BuildOptionMenu(tabs, menu, "Profile", false, true);

    // API Key
    let mainAPIKeyLabel = document.createElement("label");
    mainAPIKeyLabel.textContent = "API Key";

    let mainAPIKeyInput = document.createElement("input");
    mainAPIKeyInput.value = GetStorageEmptyIfUndefined(StorageKey.PrimaryAPIKey);

    btnValidatemainAPIKey = document.createElement("input");
    btnValidatemainAPIKey.type = "button";
    btnValidatemainAPIKey.value = "Validate";
    btnValidatemainAPIKey.className = "TDup_buttonInOptionMenu";

    function OnTornAPIKeyVerified(success, reason) {
        btnValidatemainAPIKey.disabled = false;
        SetStorage(StorageKey.IsPrimaryAPIKeyValid, success);
        if (success === true) {
            successValidatemainAPIKey.style.visibility = "visible";
            apiRegister.style.display = "none";
            FetchUserDataFromBSPServer();
        }
        else {
            RefreshOptionMenuWithSubscription();
            errorValidatemainAPIKey.style.visibility = "visible";
            apiRegister.style.display = "block";
            errorValidatemainAPIKey.textContent = String(reason || "");
            subscriptionEndText.textContent = "";
            let invalidApiKeyMessage = document.createElement("div");
            invalidApiKeyMessage.style.color = "red";
            invalidApiKeyMessage.textContent = "Please fill a valid API Key, and press on validate to get your subscription details";
            subscriptionEndText.appendChild(invalidApiKeyMessage);
        }
    }

    btnValidatemainAPIKey.addEventListener("click", () => {
        errorValidatemainAPIKey.style.visibility = "hidden";
        successValidatemainAPIKey.style.visibility = "hidden";
        btnValidatemainAPIKey.disabled = true;
        SetStorage(StorageKey.PrimaryAPIKey, mainAPIKeyInput.value);
        VerifyTornAPIKey(OnTornAPIKeyVerified);
    });

    successValidatemainAPIKey = document.createElement("label");
    successValidatemainAPIKey.textContent = "API Key verified and saved!";
    successValidatemainAPIKey.style.color = 'green';
    successValidatemainAPIKey.style.visibility = "hidden";

    errorValidatemainAPIKey = document.createElement("label");
    errorValidatemainAPIKey.textContent = "Error while verifying API Key";
    errorValidatemainAPIKey.style.backgroundColor = 'red';
    errorValidatemainAPIKey.style.visibility = "hidden";

    let mainAPIKeyDiv = document.createElement("div");
    mainAPIKeyDiv.className = "TDup_optionsTabContentDiv";
    mainAPIKeyDiv.appendChild(mainAPIKeyLabel);
    mainAPIKeyDiv.appendChild(mainAPIKeyInput);
    mainAPIKeyDiv.appendChild(btnValidatemainAPIKey);
    mainAPIKeyDiv.appendChild(successValidatemainAPIKey);
    mainAPIKeyDiv.appendChild(errorValidatemainAPIKey);
    contentDiv.appendChild(mainAPIKeyDiv);

    apiRegister = BSPCreateApiRegisterLink(
        "https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=BSP_Main&user=basic,personalstats,profile",
        "Generate a basic key"
    );
    contentDiv.appendChild(apiRegister);

    // Subscription info
    subscriptionEndText = document.createElement("div");
    subscriptionEndText.className = "TDup_optionsTabContentDiv";
    subscriptionEndText.textContent = "";
    let subscriptionHint = document.createElement("div");
    subscriptionHint.style.color = BSPSafeCssColor(GetColorTheme(), mainColor);
    subscriptionHint.textContent = "Please fill a valid API Key, and press on validate to get your subscription details";
    subscriptionEndText.appendChild(subscriptionHint);

    if (GetStorageBoolWithDefaultValue(StorageKey.IsPrimaryAPIKeyValid, false) == true) {
        apiRegister.style.display = "none";
        subscriptionEndText.textContent = "";
        let fetchingSubscriptionHint = document.createElement("div");
        fetchingSubscriptionHint.style.color = BSPSafeCssColor(GetColorTheme(), mainColor);
        fetchingSubscriptionHint.textContent = "Fetching subscription infos from BSP server, it should not be long...";
        subscriptionEndText.appendChild(fetchingSubscriptionHint);
    }
    contentDiv.appendChild(subscriptionEndText);

    // Test free localstorage
    let result = TestLocalStorage();
    if (result == false) {
        let localStorageTest = document.createElement("div");
        localStorageTest.className = "TDup_optionsTabContentDiv";
        localStorageTest.style.color = 'red';
        localStorageTest.appendChild(document.createTextNode('Your localstorage seems to be full, preventing BSP to work properly. This issue is usually caused by Chat2.0 using all the space (currently under investigation). Clear your localstorage using tools available in Debug tab ("Clear Chat entries"), or ask more info in '));
        let discordLink = document.createElement("a");
        discordLink.href = "https://discord.gg/zgrVX5j6MQ";
        discordLink.target = "_blank";
        discordLink.rel = "noopener noreferrer";
        discordLink.textContent = "Discord";
        localStorageTest.appendChild(discordLink);
        localStorageTest.appendChild(document.createTextNode("."));
        contentDiv.appendChild(localStorageTest);
    }
}

function ReComputeStats(str, def, spd, dex) {
    let localBattleStats = new Object();
    localBattleStats.Str = str;
    localBattleStats.Def = def;
    localBattleStats.Spd = spd;
    localBattleStats.Dex = dex;
    localBattleStats.TBS = localBattleStats.Str + localBattleStats.Def + localBattleStats.Spd + localBattleStats.Dex;
    localBattleStats.Score = parseInt(Math.sqrt(localBattleStats.Str) + Math.sqrt(localBattleStats.Def) + Math.sqrt(localBattleStats.Spd) + Math.sqrt(localBattleStats.Dex));

    SetLocalBattleStats(localBattleStats);
}

function BSPFormatComparisonBattleStatsText(localBattleStats) {
    if (!localBattleStats) return "TBS = 0 | Battle Score = 0";
    return "TBS = " + localBattleStats.TBS.toLocaleString('en-US') + " | Battle Score = " + localBattleStats.Score.toLocaleString('en-US');
}

function BSPUpdateComparisonBattleStatsText(localBattleStats) {
    if (!comparisonBattleStatsText) return;
    comparisonBattleStatsText.textContent = BSPFormatComparisonBattleStatsText(localBattleStats);
}

function OnPlayerStatsFromTornAPI(success, reason) {
    btnValidategymStatsAPIKey.disabled = false;
    SetStorage(StorageKey.IsBattleStatsAPIKeyValid, success);
    if (success === true) {
        successValidategymStatsAPIKey.style.visibility = "visible";
        apiRegister.style.display = "none";

        let localBattleStats = GetLocalBattleStats();

        scoreStrInput.value = parseInt(localBattleStats.Str);
        scoreDefInput.value = parseInt(localBattleStats.Def);
        scoreSpdInput.value = parseInt(localBattleStats.Spd);
        scoreDexInput.value = parseInt(localBattleStats.Dex);

        BSPUpdateComparisonBattleStatsText(localBattleStats);
    }
    else {
        apiRegister.style.display = "block";
        errorValidategymStatsAPIKey.style.visibility = "visible";
        errorValidategymStatsAPIKey.textContent = String(reason || "");
    }
}

function BuildOptionMenu_Colors(tabs, menu) {
    let contentDiv = BuildOptionMenu(tabs, menu, "Settings", true);

    let localBattleStats = GetLocalBattleStats();

    // API Key
    let gymStatsAPIKeyLabel = document.createElement("label");
    gymStatsAPIKeyLabel.textContent = "API Key";

    let gymStatsAPIKeyInput = document.createElement("input");
    if (GetStorage(StorageKey.BattleStatsAPIKey)) {
        gymStatsAPIKeyInput.value = GetStorage(StorageKey.BattleStatsAPIKey);
    }

    btnValidategymStatsAPIKey = document.createElement("input");
    btnValidategymStatsAPIKey.type = "button";
    btnValidategymStatsAPIKey.value = "Import stats";
    btnValidategymStatsAPIKey.className = "TDup_buttonInOptionMenu";

    successValidategymStatsAPIKey = document.createElement("label");
    successValidategymStatsAPIKey.textContent = "Stats imported!";
    successValidategymStatsAPIKey.style.color = 'green';
    successValidategymStatsAPIKey.style.visibility = "hidden";

    errorValidategymStatsAPIKey = document.createElement("label");
    errorValidategymStatsAPIKey.textContent = "Error while verifying gymStats API Key";
    errorValidategymStatsAPIKey.style.backgroundColor = 'red';
    errorValidategymStatsAPIKey.style.visibility = "hidden";

    btnValidategymStatsAPIKey.addEventListener("click", () => {
        errorValidategymStatsAPIKey.style.visibility = "hidden";
        successValidategymStatsAPIKey.style.visibility = "hidden";
        btnValidategymStatsAPIKey.disabled = true;
        SetStorage(StorageKey.BattleStatsAPIKey, gymStatsAPIKeyInput.value);
        GetPlayerStatsFromTornAPI(OnPlayerStatsFromTornAPI);
    });

    let gymStatsApiKeyDiv = document.createElement("div");
    gymStatsApiKeyDiv.className = "TDup_optionsTabContentDiv";
    gymStatsApiKeyDiv.appendChild(gymStatsAPIKeyLabel);
    gymStatsApiKeyDiv.appendChild(gymStatsAPIKeyInput);
    gymStatsApiKeyDiv.appendChild(btnValidategymStatsAPIKey);
    gymStatsApiKeyDiv.appendChild(successValidategymStatsAPIKey);
    gymStatsApiKeyDiv.appendChild(errorValidategymStatsAPIKey);
    contentDiv.appendChild(gymStatsApiKeyDiv);

    // Auto Import stats
    let isAutoImportStatsDiv = document.createElement("div");
    isAutoImportStatsDiv.className = "TDup_optionsTabContentDiv";
    let isAutoImportStats = GetStorageBoolWithDefaultValue(StorageKey.IsAutoImportStats, false);

    let checkboxisAutoImportStats = document.createElement('input');
    checkboxisAutoImportStats.type = "checkbox";
    checkboxisAutoImportStats.name = "name";
    checkboxisAutoImportStats.value = "value";
    checkboxisAutoImportStats.id = "idisAutoImportStats";
    checkboxisAutoImportStats.checked = isAutoImportStats;

    checkboxisAutoImportStats.addEventListener("change", () => {
        let isAutoImportStatsNew = checkboxisAutoImportStats.checked;
        SetStorage(StorageKey.IsAutoImportStats, isAutoImportStatsNew);
    });

    var isAutoImportStatsLabel = document.createElement('label')
    isAutoImportStatsLabel.htmlFor = "idisAutoImportStats";
    isAutoImportStatsLabel.appendChild(document.createTextNode('Auto-import stats once a day?'));
    isAutoImportStatsDiv.appendChild(isAutoImportStatsLabel);
    isAutoImportStatsDiv.appendChild(checkboxisAutoImportStats);
    contentDiv.appendChild(isAutoImportStatsDiv);

    let apiRegister = BSPCreateApiRegisterLink(
        "https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=BSP_Gym&user=basic,personalstats,profile,battlestats",
        "Generate a key with access to your battlestats",
        "280px"
    );
    contentDiv.appendChild(apiRegister);

    if (GetStorageBoolWithDefaultValue(StorageKey.IsBattleStatsAPIKeyValid, false) == true) {
        apiRegister.style.display = "none";
    }

    // COMPARISON STATS PART
    let comparisonBattleStatsNode = document.createElement("div");
    comparisonBattleStatsNode.className = "TDup_optionsTabContentDiv";
    contentDiv.appendChild(comparisonBattleStatsNode);

    var cell, raw, table;
    table = document.createElement('table');

    comparisonBattleStatsNode.appendChild(table);

    // ************************** DEX ***********************
    let comparisonDex = document.createElement("label");
    comparisonDex.style.textAlign = "right";
    comparisonDex.style.marginRight = "10px";
    comparisonDex.textContent = "Dex";
    raw = table.insertRow(0);
    cell = raw.insertCell(0);
    cell.width = '50%';
    cell.appendChild(comparisonDex);

    scoreDexInput = document.createElement("input");
    scoreDexInput.type = 'number';
    scoreDexInput.value = localBattleStats.Dex;

    scoreDexInput.addEventListener('change', () => {
        if (scoreDexInput.value) scoreDexInput.value = parseInt(scoreDexInput.value);
        else scoreDexInput.value = 0;

        ReComputeStats(parseInt(scoreStrInput.value), parseInt(scoreDefInput.value), parseInt(scoreSpdInput.value), parseInt(scoreDexInput.value));
        localBattleStats = GetLocalBattleStats();
        BSPUpdateComparisonBattleStatsText(localBattleStats);
    });
    cell = raw.insertCell(1);
    cell.style.textAlign = 'left';
    cell.appendChild(scoreDexInput);

    // ************************** SPD ***********************
    let comparisonSpd = document.createElement("label");
    comparisonSpd.style.textAlign = "right";
    comparisonSpd.style.marginRight = "10px";
    comparisonSpd.textContent = "Spd";
    raw = table.insertRow(0);
    cell = raw.insertCell(0);
    cell.appendChild(comparisonSpd);

    scoreSpdInput = document.createElement("input");
    scoreSpdInput.type = 'number';
    scoreSpdInput.value = localBattleStats.Spd;

    scoreSpdInput.addEventListener('change', () => {
        if (scoreSpdInput.value) scoreSpdInput.value = parseInt(scoreSpdInput.value);
        else scoreSpdInput.value = 0;

        ReComputeStats(parseInt(scoreStrInput.value), parseInt(scoreDefInput.value), parseInt(scoreSpdInput.value), parseInt(scoreDexInput.value));
        localBattleStats = GetLocalBattleStats();
        BSPUpdateComparisonBattleStatsText(localBattleStats);
    });
    cell = raw.insertCell(1);
    cell.style.textAlign = 'left';
    cell.appendChild(scoreSpdInput);

    // ************************** DEF ***********************
    let comparisonDef = document.createElement("label");
    comparisonDef.style.textAlign = "right";
    comparisonDef.style.marginRight = "10px";
    comparisonDef.textContent = "Def";
    raw = table.insertRow(0);
    cell = raw.insertCell(0);
    cell.appendChild(comparisonDef);

    scoreDefInput = document.createElement("input");
    scoreDefInput.type = 'number';
    scoreDefInput.value = localBattleStats.Def;

    scoreDefInput.addEventListener('change', () => {
        if (scoreDefInput.value) scoreDefInput.value = parseInt(scoreDefInput.value);
        else scoreDefInput.value = 0;

        ReComputeStats(parseInt(scoreStrInput.value), parseInt(scoreDefInput.value), parseInt(scoreSpdInput.value), parseInt(scoreDexInput.value));
        localBattleStats = GetLocalBattleStats();
        BSPUpdateComparisonBattleStatsText(localBattleStats);
    });
    cell = raw.insertCell(1);
    cell.style.textAlign = 'left';
    cell.appendChild(scoreDefInput);

    // ************************** STR ***********************
    let comparisonStr = document.createElement("label");
    comparisonStr.style.textAlign = "right";
    comparisonStr.style.marginRight = "10px";
    comparisonStr.textContent = "Str";
    raw = table.insertRow(0);
    cell = raw.insertCell(0);
    cell.appendChild(comparisonStr);

    scoreStrInput = document.createElement("input");
    scoreStrInput.type = 'number';
    scoreStrInput.value = localBattleStats.Str;

    scoreStrInput.addEventListener('change', () => {
        if (scoreStrInput.value) scoreStrInput.value = parseInt(scoreStrInput.value);
        else scoreStrInput.value = 0;

        ReComputeStats(parseInt(scoreStrInput.value), parseInt(scoreDefInput.value), parseInt(scoreSpdInput.value), parseInt(scoreDexInput.value));
        localBattleStats = GetLocalBattleStats();
        BSPUpdateComparisonBattleStatsText(localBattleStats);
    });
    cell = raw.insertCell(1);
    cell.style.textAlign = 'left';
    cell.appendChild(scoreStrInput);

    comparisonBattleStatsText = document.createElement("div");
    comparisonBattleStatsText.className = "TDup_optionsTabContentDiv";
    BSPUpdateComparisonBattleStatsText(localBattleStats);

    comparisonBattleStatsNode.appendChild(comparisonBattleStatsText);

    let colorSettingsNode = document.createElement("div");
    colorSettingsNode.className = "TDup_optionsTabContentDiv";

    // Show Score instead
    let isShowingBattleStatsScoreDiv = document.createElement("div");
    isShowingBattleStatsScoreDiv.className = "TDup_optionsTabContentDiv";
    let isShowingBattleStatsScore = GetStorageBoolWithDefaultValue(StorageKey.IsShowingBattleStatsScore, false);

    let checkboxisShowingBattleStatsScore = document.createElement('input');
    checkboxisShowingBattleStatsScore.type = "checkbox";
    checkboxisShowingBattleStatsScore.name = "name";
    checkboxisShowingBattleStatsScore.value = "value";
    checkboxisShowingBattleStatsScore.id = "idIsShowingBattleScore";
    checkboxisShowingBattleStatsScore.checked = isShowingBattleStatsScore;

    checkboxisShowingBattleStatsScore.addEventListener("change", () => {
        let isShowingBattleStatsScore = checkboxisShowingBattleStatsScore.checked;
        BuildCustomizeColorThresholdPanel(isShowingBattleStatsScore);
        SetStorage(StorageKey.IsShowingBattleStatsScore, isShowingBattleStatsScore);
    });

    var isShowingBattleStatsScoreLabel = document.createElement('label')
    isShowingBattleStatsScoreLabel.htmlFor = "idIsShowingBattleScore";
    isShowingBattleStatsScoreLabel.appendChild(document.createTextNode("Use "));
    let battleScoreLink = document.createElement("a");
    battleScoreLink.href = "https://wiki.torn.com/wiki/Chain#Fair_fights";
    battleScoreLink.target = "_blank";
    battleScoreLink.rel = "noopener noreferrer";
    battleScoreLink.textContent = "Battle Stat Score";
    isShowingBattleStatsScoreLabel.appendChild(battleScoreLink);
    isShowingBattleStatsScoreLabel.appendChild(document.createTextNode(" rather than TBS (Total Battle Stats)"));
    isShowingBattleStatsScoreDiv.appendChild(isShowingBattleStatsScoreLabel);
    isShowingBattleStatsScoreDiv.appendChild(checkboxisShowingBattleStatsScore);
    contentDiv.appendChild(isShowingBattleStatsScoreDiv);

    let colorExplanations = document.createElement("label");
    colorExplanations.textContent = "Color code used when displaying a Torn player, relative to the battle stats you defined above";
    colorExplanations.style.fontStyle = "italic";
    colorSettingsNode.appendChild(colorExplanations);

    BuildCustomizeColorThresholdPanel(isShowingBattleStatsScore);

    colorSettingsNode.appendChild(divThresholdColorsPanel);
    contentDiv.appendChild(colorSettingsNode);
}

function BuildCustomizeColorThresholdPanel(isBSScoreMode) {
    if (divThresholdColorsPanel == undefined) {
        divThresholdColorsPanel = document.createElement("div");
        divThresholdColorsPanel.className = "TDup_optionsTabContentDiv";
    }
    divThresholdColorsPanel.textContent = "";

    for (var i = 0; i < LOCAL_COLORS.length; ++i) {
        LOCAL_COLORS[i] = BSPReadColorThreshold(i);
        AddColorPanel(isBSScoreMode, divThresholdColorsPanel, LOCAL_COLORS[i], i);
    }
    return divThresholdColorsPanel;
}

function AddColorPanel(isBSScoreMode, colorSettingsNode, colorItem, id) {
    let divColor = document.createElement("div");
    divColor.className = "TDup_optionsTabContentDiv";

    let text = document.createElement("label");
    text.textContent = "Up to";
    divColor.appendChild(text);

    let colorThresholdInput = document.createElement("input");
    colorThresholdInput.type = 'number';
    colorThresholdInput.value = isBSScoreMode ? parseInt(colorItem.maxValueScore) : parseInt(colorItem.maxValue);
    colorThresholdInput.style.width = '40px';
    colorThresholdInput.disabled = !colorItem.canModify;

    colorThresholdInput.addEventListener("change", () => {
        if (isBSScoreMode) {
            let newThresholdScoreMaxValue = parseInt(colorThresholdInput.value);
            LOCAL_COLORS[id].maxValueScore = newThresholdScoreMaxValue;

            let FairFight = Math.min(1 + (8 / 3) * (colorItem.maxValueScore / 100), 3);
            FairFight = Math.max(1, FairFight);
            FairFight = FairFight.toFixed(2);
            textPercent.textContent = '% of BS Score (max FairFight=' + FairFight + ')';
        }
        else {
            let newThresholdMaxValue = parseInt(colorThresholdInput.value);
            LOCAL_COLORS[id].maxValue = newThresholdMaxValue;
        }
        SetStorage(StorageKey.ColorStatsThreshold + id, JSON.stringify(LOCAL_COLORS[id]));
    });

    divColor.appendChild(colorThresholdInput);
    colorItem.inputNumber = colorThresholdInput;

    let textPercent = document.createElement("label");

    if (isBSScoreMode) {
        let FairFight = Math.min(1 + (8 / 3) * (colorItem.maxValueScore / 100), 3);
        FairFight = Math.max(1, FairFight);
        FairFight = FairFight.toFixed(2);
        textPercent.textContent = '% of BS Score (max FairFight=' + FairFight + ')';
    }
    else {
        textPercent.textContent = "% of TBS";
    }

    divColor.appendChild(textPercent);

    let colorPickerInput = document.createElement("input");
    colorPickerInput.type = "color";
    colorPickerInput.value = colorItem.color;

    colorPickerInput.addEventListener("change", () => {
        LOCAL_COLORS[id].color = colorPickerInput.value;
        SetStorage(StorageKey.ColorStatsThreshold + id, JSON.stringify(LOCAL_COLORS[id]));
    });

    divColor.appendChild(colorPickerInput);
    colorItem.inputColor = colorPickerInput;

    colorSettingsNode.appendChild(divColor);
}

function AddOption(contentDiv, StorageKeyValue, defaultValue, textToDisplay, name) {
    // Alternative profile display
    let optionNode = document.createElement("div");
    optionNode.className = "TDup_optionsTabContentDiv";
    let isShowingAlternativeProfileDisplay = GetStorageBoolWithDefaultValue(StorageKeyValue, defaultValue);

    let optionCheckbox = document.createElement('input');
    optionCheckbox.type = "checkbox";
    optionCheckbox.name = "name";
    optionCheckbox.value = "value";
    optionCheckbox.id = "id" + name;
    optionCheckbox.checked = isShowingAlternativeProfileDisplay;

    optionCheckbox.addEventListener("change", () => {
        let isOptionValue = optionCheckbox.checked;
        SetStorage(StorageKeyValue, isOptionValue);
    });

    var optionLabel = document.createElement('label')
    optionLabel.htmlFor = "id" + name;
    optionLabel.appendChild(document.createTextNode(textToDisplay));
    optionNode.appendChild(optionLabel);
    optionNode.appendChild(optionCheckbox);
    contentDiv.appendChild(optionNode);
}

function BuildOptionMenu_Pages(tabs, menu) {
    let contentDiv = BuildOptionMenu(tabs, menu, "Pages", true);

    // Displaying Honor bars
    AddOption(contentDiv, StorageKey.IsShowingHonorBars, true, 'Are you displaying honor bars?', 'isShowingHonorBars');

    // Enable on own profile
    AddOption(contentDiv, StorageKey.IsEnabledOnOwnProfile, false, 'Show stats on your own profile page?', 'IsEnabledOnOwnProfile');

    // Alternative profile display
    AddOption(contentDiv, StorageKey.IsShowingAlternativeProfileDisplay, false, 'Use alternative profile stats location?', 'IsShowingAlternativeProfileDisplay');

    // Alternative profile display
    AddOption(contentDiv, StorageKey.IsShowingStatsHeader, true, 'Show headers above profile stats?', 'IsShowingHeadersOnProfileStats');

    // Alternative profile display
    AddOption(contentDiv, StorageKey.IsClickingOnProfileStatsAttackPlayer, false, 'Click on profile stats area to attack?', 'IsClickingOnProfileStatsAttackPlayer');

    // Open attack in new tab
    AddOption(contentDiv, StorageKey.ShouldOpenAttackURLInNewTab, true, 'Open attack screen in new tab', 'ShouldOpenAttackURLInNewTab');

    // Hide BSP Option button, in toolbar
    AddOption(contentDiv, StorageKey.IsHidingBSPOptionButtonInToolbar, false, 'Hide BSP Option button in toolbar?', 'IsHidingBSPOptionButtonInToolbar');

    // Show Percentage instead
    AddOption(contentDiv, StorageKey.IsShowingBattleStatsPercentage, false, 'Display percentage rather than values in little colored squares?', 'IsShowingBattleStatsPercentage');

    // Sort on faction page
    AddOption(contentDiv, StorageKey.HasSortByBSPButtonsOnFactionPage, true, 'Allow sorting by BSP on faction/war page?', 'HasSortByBSPButtonsOnFactionPage');
    

    // Spy
    let spyNumberOfDaysDiv = document.createElement("div");
    spyNumberOfDaysDiv.className = "TDup_optionsTabContentDiv";
    let spyNumberOfDaysDivLabel = document.createElement("label");
    spyNumberOfDaysDivLabel.textContent = "Display spy instead of prediction if spy more recent than ";

    let spyNumberOfDaysDivLabelPart2 = document.createElement("label");
    spyNumberOfDaysDivLabelPart2.textContent = "days";

    let tornStatsNumberOfDaysInput = document.createElement("input");
    tornStatsNumberOfDaysInput.type = 'number';
    tornStatsNumberOfDaysInput.style.width = '60px';
    tornStatsNumberOfDaysInput.value = BSPStorageGetInt(StorageKey.DaysToUseSpies, 30);

    tornStatsNumberOfDaysInput.addEventListener("change", () => {
        let numberOfDaysNewValue = parseInt(tornStatsNumberOfDaysInput.value);
        SetStorage(StorageKey.DaysToUseSpies, numberOfDaysNewValue);
    });

    spyNumberOfDaysDiv.appendChild(spyNumberOfDaysDivLabel);
    spyNumberOfDaysDiv.appendChild(tornStatsNumberOfDaysInput);
    spyNumberOfDaysDiv.appendChild(spyNumberOfDaysDivLabelPart2);
    contentDiv.appendChild(spyNumberOfDaysDiv);

    // BSP Color schema
    let colorSchemaDiv = document.createElement("div");
    colorSchemaDiv.className = "TDup_optionsTabContentDiv";

    let colorPickerInput = document.createElement("input");
    colorPickerInput.type = "color";
    colorPickerInput.value = GetColorTheme();

    colorPickerInput.addEventListener("change", () => {
        let color = colorPickerInput.value;
        SetStorage(StorageKey.BSPColorTheme, JSON.stringify(color));
    });

    let colorThemeLabel = document.createElement("label");
    colorThemeLabel.textContent = "BSP Theme color ";

    colorSchemaDiv.appendChild(colorThemeLabel);
    colorSchemaDiv.appendChild(colorPickerInput);
    contentDiv.appendChild(colorSchemaDiv);

    // Pages
    let textExplanation = document.createElement("div");
    textExplanation.className = "TDup_optionsTabContentDiv";
    textExplanation.textContent = "Select where BSP is enabled";
    contentDiv.appendChild(textExplanation);

    // Pages where it's enabled
    let divForCheckbox = document.createElement("div");
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Profile, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Faction, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Bounty, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Search, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Abroad, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Competition, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Elimination, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.HallOfFame, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Enemies, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Friends, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Targets, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.RecruitCitizens, false);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Company, false);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Hospital, false);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.PointMarket, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Properties, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.War, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.RussianRoulette, true, false);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Market, false, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Forum, false, true);
    BuildOptionsCheckboxPageWhereItsEnabled(divForCheckbox, PageType.Attack, false, true);

    contentDiv.appendChild(divForCheckbox);
}

function BuildOptionsCheckboxPageWhereItsEnabled(parentDiv, pageType, defaultValue, proto) {

    let pageCheckBoxNode = document.createElement("div");
    pageCheckBoxNode.className = "TDup_optionsTabContentDivSmall";

    let checkboxPage = document.createElement('input');
    checkboxPage.type = "checkbox";
    checkboxPage.name = "name";
    checkboxPage.value = "value";
    checkboxPage.style.margin = "5px 10px";
    checkboxPage.id = "id_" + pageType;
    checkboxPage.checked = GetStorageBoolWithDefaultValue(StorageKey.IsBSPEnabledOnPage + pageType, defaultValue);

    checkboxPage.addEventListener("change", () => {
        let isBSPEnabledForThisPage = checkboxPage.checked;
        SetStorage(StorageKey.IsBSPEnabledOnPage + pageType, isBSPEnabledForThisPage);
    });

    var checkboxLabel = document.createElement('label')
    checkboxLabel.htmlFor = checkboxPage.id;
    if (proto == true) {
        checkboxLabel.appendChild(document.createTextNode("[Beta] " + pageType));
    }
    else {
        checkboxLabel.appendChild(document.createTextNode(pageType));
    }

    pageCheckBoxNode.appendChild(checkboxPage);
    pageCheckBoxNode.appendChild(checkboxLabel);
    parentDiv.appendChild(pageCheckBoxNode);
}

function BuildOptionMenu_Uploadstats(tabs, menu) {
    let contentDiv = BuildOptionMenu(tabs, menu, "Upload Data", false);

    // UploadStats
    let UploadStatsNode = document.createElement("div");
    UploadStatsNode.className = "TDup_optionsTabContentDiv";

    let tipsDiv = document.createElement("div");
    tipsDiv.className = "TDup_optionsTabContentDiv";
    tipsDiv.style.whiteSpace = "pre-line";
    tipsDiv.textContent = "Upload your attack logs to help BSP being more accurate.\n\nRequires a custom key (this API key is sent to the server but wont be stored. Your own stats are not stored nor shared).\n\nGet 3 months worth of subscription once, when your first useful record is uploaded (less than FF3, more recent than 48h).\n\nThank you for helping BSP accuracy.";

    let additionalSub = document.createElement("div");
    additionalSub.className = "TDup_optionsTabContentDiv";
    additionalSub.textContent = "Setup and you will gain 3 months of BSP subscription";

    let UploadStatsAPIKeyLabel = document.createElement("label");
    UploadStatsAPIKeyLabel.textContent = "Your API key";

    let UploadStatsAPIKeyInput = document.createElement("input");
    if (GetStorage(StorageKey.UploadDataAPIKey)) {
        UploadStatsAPIKeyInput.value = GetStorage(StorageKey.UploadDataAPIKey);
    }

    let apiRegister = BSPCreateApiRegisterLink(
        "https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=BSP_Attacks&user=basic,attacks,battlestats",
        "Generate a custom key"
    );

    let btnFetchSpiesFromUploadStats = document.createElement("input");
    btnFetchSpiesFromUploadStats.type = "button";
    btnFetchSpiesFromUploadStats.value = "Upload my latest fights";
    btnFetchSpiesFromUploadStats.className = "TDup_buttonInOptionMenu";

    let successValidateUploadStatsAPIKey = document.createElement("label");
    successValidateUploadStatsAPIKey.textContent = "UploadStats API Key verified, and attacks added to the system. Thanks";
    successValidateUploadStatsAPIKey.style.color = 'green';
    successValidateUploadStatsAPIKey.style.visibility = "hidden";

    let errorValidateUploadStatsAPIKey = document.createElement("label");
    errorValidateUploadStatsAPIKey.textContent = "Error";
    errorValidateUploadStatsAPIKey.style.backgroundColor = 'red';
    errorValidateUploadStatsAPIKey.style.visibility = "hidden";

    function OnUploadStatsSpiesFetched(success, reason) {
        btnFetchSpiesFromUploadStats.disabled = false;
        SetStorage(StorageKey.UploadDataAPIKeyIsValid, success);
        if (success === true) {
            successValidateUploadStatsAPIKey.style.visibility = "visible";
            successValidateUploadStatsAPIKey.textContent = String(reason || "");
            errorValidateUploadStatsAPIKey.style.visibility = "hidden";
        }
        else {
            errorValidateUploadStatsAPIKey.style.visibility = "visible";
            successValidateUploadStatsAPIKey.style.visibility = "hidden";
            errorValidateUploadStatsAPIKey.textContent = String(reason || "");
        }
    }

    btnFetchSpiesFromUploadStats.addEventListener("click", () => {
        btnFetchSpiesFromUploadStats.disabled = true;
        SetStorage(StorageKey.UploadDataAPIKey, UploadStatsAPIKeyInput.value);
        CallBSPUploadStats(OnUploadStatsSpiesFetched);
    });


    let isAutoUploadStatsNode = document.createElement("div");
    isAutoUploadStatsNode.className = "TDup_optionsTabContentDiv";
    let isAutoUploadStats = GetStorageBoolWithDefaultValue(StorageKey.UploadDataIsAutoMode, true);

    let checkboxisAutoUploadStats = document.createElement('input');
    checkboxisAutoUploadStats.type = "checkbox";
    checkboxisAutoUploadStats.name = "name";
    checkboxisAutoUploadStats.value = "value";
    checkboxisAutoUploadStats.id = "idIsAutoUploadStats";
    checkboxisAutoUploadStats.checked = isAutoUploadStats;

    checkboxisAutoUploadStats.addEventListener("change", () => {
        let isAutoUploadStats = checkboxisAutoUploadStats.checked;
        SetStorage(StorageKey.UploadDataIsAutoMode, isAutoUploadStats);
    });

    var isAutoUploadStatsLabel = document.createElement('label')
    isAutoUploadStatsLabel.htmlFor = "idIsAutoUploadStats";
    isAutoUploadStatsLabel.appendChild(document.createTextNode('Auto Upload your latest attacks, once a day'));
    isAutoUploadStatsNode.appendChild(isAutoUploadStatsLabel);
    isAutoUploadStatsNode.appendChild(checkboxisAutoUploadStats);

    //

    let UploadStatsApiKeyDiv = document.createElement("div");
    UploadStatsApiKeyDiv.className = "TDup_optionsTabContentDiv";
    UploadStatsApiKeyDiv.appendChild(tipsDiv);
    if (!GetStorageBool(StorageKey.UploadDataAPIKeyIsValid)) {
        UploadStatsApiKeyDiv.appendChild(additionalSub);
        UploadStatsApiKeyDiv.appendChild(apiRegister);
    }
    UploadStatsApiKeyDiv.appendChild(UploadStatsAPIKeyLabel);
    UploadStatsApiKeyDiv.appendChild(UploadStatsAPIKeyInput);
    UploadStatsApiKeyDiv.appendChild(btnFetchSpiesFromUploadStats);
    UploadStatsApiKeyDiv.appendChild(successValidateUploadStatsAPIKey);
    UploadStatsApiKeyDiv.appendChild(errorValidateUploadStatsAPIKey);
    if (GetStorage(StorageKey.UploadDataAPIKeyIsValid)) {
        UploadStatsApiKeyDiv.appendChild(isAutoUploadStatsNode);
    }
    UploadStatsNode.appendChild(UploadStatsApiKeyDiv);

    contentDiv.appendChild(UploadStatsNode);
}

function BuildOptionMenu_YATA(tabs, menu) {
    let contentDiv = BuildOptionMenu(tabs, menu, "YATA", true);

    // Yata spies
    let YataNode = document.createElement("div");
    YataNode.className = "TDup_optionsTabContentDiv";

    let YataAPIKeyLabel = document.createElement("label");
    YataAPIKeyLabel.textContent = "Yata API Key";

    let YataAPIKeyInput = document.createElement("input");
    if (GetStorage(StorageKey.YataAPIKey)) {
        YataAPIKeyInput.value = GetStorage(StorageKey.YataAPIKey);
    }

    btnFetchSpiesFromYata = document.createElement("input");
    btnFetchSpiesFromYata.type = "button";
    btnFetchSpiesFromYata.value = "Import spies from Yata";
    btnFetchSpiesFromYata.className = "TDup_buttonInOptionMenu";

    successValidateYataAPIKey = document.createElement("label");
    successValidateYataAPIKey.textContent = "Yata API Key verified";
    successValidateYataAPIKey.style.color = 'green';
    successValidateYataAPIKey.style.visibility = "hidden";

    errorValidateYataAPIKey = document.createElement("label");
    errorValidateYataAPIKey.textContent = "Error";
    errorValidateYataAPIKey.style.backgroundColor = 'red';
    errorValidateYataAPIKey.style.visibility = "hidden";

    let YataApiKeyDiv = document.createElement("div");
    YataApiKeyDiv.className = "TDup_optionsTabContentDiv";
    YataApiKeyDiv.appendChild(YataAPIKeyLabel);
    YataApiKeyDiv.appendChild(YataAPIKeyInput);
    YataApiKeyDiv.appendChild(btnFetchSpiesFromYata);
    YataApiKeyDiv.appendChild(successValidateYataAPIKey);
    YataApiKeyDiv.appendChild(errorValidateYataAPIKey);
    YataNode.appendChild(YataApiKeyDiv);

    function OnYataSpiesFetched(success, reason) {
        btnFetchSpiesFromYata.disabled = false;
        SetStorage(StorageKey.IsYataAPIKeyValid, success);
        if (success === true) {
            successValidateYataAPIKey.style.visibility = "visible";
            successValidateYataAPIKey.textContent = String(reason || "");
            errorValidateYataAPIKey.style.visibility = "hidden";
        }
        else {
            errorValidateYataAPIKey.style.visibility = "visible";
            successValidateYataAPIKey.style.visibility = "hidden";
            errorValidateYataAPIKey.textContent = String(reason || "");
        }
    }

    btnFetchSpiesFromYata.addEventListener("click", () => {
        btnFetchSpiesFromYata.disabled = true;
        SetStorage(StorageKey.YataAPIKey, YataAPIKeyInput.value);
        FetchSpiesFromYata(OnYataSpiesFetched);
    });

    contentDiv.appendChild(YataNode);
}

function BuildOptionMenu_TornStats(tabs, menu) {
    let contentDiv = BuildOptionMenu(tabs, menu, "TornStats", true);

    // TornStats spies
    let tornStatsNode = document.createElement("div");
    tornStatsNode.className = "TDup_optionsTabContentDiv";

    let tornStatsAPIKeyLabel = document.createElement("label");
    tornStatsAPIKeyLabel.textContent = "TornStats API Key";

    let tornStatsAPIKeyInput = document.createElement("input");
    if (GetStorage(StorageKey.TornStatsAPIKey)) {
        tornStatsAPIKeyInput.value = GetStorage(StorageKey.TornStatsAPIKey);
    }

    btnValidateTornStatsAPIKey = document.createElement("input");
    btnValidateTornStatsAPIKey.type = "button";
    btnValidateTornStatsAPIKey.value = "Validate";
    btnValidateTornStatsAPIKey.className = "TDup_buttonInOptionMenu";

    successValidateTornStatsAPIKey = document.createElement("label");
    successValidateTornStatsAPIKey.textContent = "TornStats API Key verified";
    successValidateTornStatsAPIKey.style.color = 'green';
    successValidateTornStatsAPIKey.style.visibility = "hidden";

    errorValidateTornStatsAPIKey = document.createElement("label");
    errorValidateTornStatsAPIKey.textContent = "Error";
    errorValidateTornStatsAPIKey.style.backgroundColor = 'red';
    errorValidateTornStatsAPIKey.style.visibility = "hidden";

    let tornStatsApiKeyDiv = document.createElement("div");
    tornStatsApiKeyDiv.className = "TDup_optionsTabContentDiv";
    tornStatsApiKeyDiv.appendChild(tornStatsAPIKeyLabel);
    tornStatsApiKeyDiv.appendChild(tornStatsAPIKeyInput);
    tornStatsApiKeyDiv.appendChild(btnValidateTornStatsAPIKey);
    tornStatsApiKeyDiv.appendChild(successValidateTornStatsAPIKey);
    tornStatsApiKeyDiv.appendChild(errorValidateTornStatsAPIKey);
    tornStatsNode.appendChild(tornStatsApiKeyDiv);

    function OnTornStatsAPIKeyValidated(success, reason) {
        btnValidateTornStatsAPIKey.disabled = false;
        SetStorage(StorageKey.IsTornStatsAPIKeyValid, success);
        if (success === true) {
            successValidateTornStatsAPIKey.style.visibility = "visible";
            errorValidateTornStatsAPIKey.style.visibility = "hidden";
        }
        else {
            errorValidateTornStatsAPIKey.style.visibility = "visible";
            successValidateTornStatsAPIKey.style.visibility = "hidden";
            errorValidateTornStatsAPIKey.textContent = String(reason || "");
        }
    }

    btnValidateTornStatsAPIKey.addEventListener("click", () => {
        btnValidateTornStatsAPIKey.disabled = true;
        SetStorage(StorageKey.TornStatsAPIKey, tornStatsAPIKeyInput.value);
        VerifyTornStatsAPIKey(OnTornStatsAPIKeyValidated);
    });

    let tornStatsImportTipsDiv = document.createElement("div");
    tornStatsImportTipsDiv.className = "TDup_optionsTabContentDiv";
    tornStatsImportTipsDiv.textContent = "To import TornStats spies, go on a specific faction page, and click on the [BSP IMPORT SPIES] button at the top of the page. Or enable the Auto Import feature below!";
    tornStatsNode.appendChild(tornStatsImportTipsDiv);

    //

    let isAutoImportTornStatsSpiesNode = document.createElement("div");
    isAutoImportTornStatsSpiesNode.className = "TDup_optionsTabContentDiv";
    let isAutoImportTornStatsSpies = GetStorageBoolWithDefaultValue(StorageKey.IsAutoImportTornStatsSpies, false);

    let checkboxisAutoImportTornStatsSpies = document.createElement('input');
    checkboxisAutoImportTornStatsSpies.type = "checkbox";
    checkboxisAutoImportTornStatsSpies.name = "name";
    checkboxisAutoImportTornStatsSpies.value = "value";
    checkboxisAutoImportTornStatsSpies.id = "idIsAutoImportTornStatsSpies";
    checkboxisAutoImportTornStatsSpies.checked = isAutoImportTornStatsSpies;

    checkboxisAutoImportTornStatsSpies.addEventListener("change", () => {
        let isAutoImportTornStatsSpies = checkboxisAutoImportTornStatsSpies.checked;
        SetStorage(StorageKey.IsAutoImportTornStatsSpies, isAutoImportTornStatsSpies);
    });

    var isAutoImportTornStatsSpiesLabel = document.createElement('label')
    isAutoImportTornStatsSpiesLabel.htmlFor = "idIsAutoImportTornStatsSpies";
    isAutoImportTornStatsSpiesLabel.appendChild(document.createTextNode('Auto Import TornStats spies? (will auto query TornStats on profile or faction page)'));
    isAutoImportTornStatsSpiesNode.appendChild(isAutoImportTornStatsSpiesLabel);
    isAutoImportTornStatsSpiesNode.appendChild(checkboxisAutoImportTornStatsSpies);
    tornStatsNode.appendChild(isAutoImportTornStatsSpiesNode);

    //

    contentDiv.appendChild(tornStatsNode);
}

function BuildOptionMenu_Debug(tabs, menu) {
    let contentDiv = BuildOptionMenu(tabs, menu, "Debug", false);

    // <LocalStorage display>
    let maxStorageSize = 5000000;

    let storageALLExceptBSPResult = GetPredictionStorage(eStorageType.ALL_ExceptBSP);
    let storageALLExceptBSPSize = storageALLExceptBSPResult[1];

    let storageTornChatResult = GetPredictionStorage(eStorageType.TornChat);
    let storageTornChatSize = storageTornChatResult[1];

    let storageALLBSPResult = GetPredictionStorage(eStorageType.All_BSP);
    let storageALLBSPSize = storageALLBSPResult[1];

    let storagePredictionResult = GetPredictionStorage(eStorageType.Prediction);
    let storagePredictionSize = storagePredictionResult[1];
    let storagePredictionNumber = storagePredictionResult[0];

    let storageTornStatsResult = GetPredictionStorage(eStorageType.TornStatsSpies);
    let storageTornStatsSize = storageTornStatsResult[1];
    let storageTornStatsNumber = storageTornStatsResult[0];

    let storageYATAResult = GetPredictionStorage(eStorageType.YATASpies);
    let storageYATASize = storageYATAResult[1];
    let storageYATANumber = storageYATAResult[0];

    let localStorageInfosDiv = document.createElement("div");
    localStorageInfosDiv.className = "TDup_optionsTabContentDiv";

    let localStorageProgressBar = document.createElement("div");
    localStorageProgressBar.className = "TDup_optionsTabContentDiv";
    localStorageProgressBar.style.whiteSpace = "pre-line";
    localStorageProgressBar.textContent = [
        "LocalStorage space is different",
        "from browser to browser.",
        "For reference, Chrome has a 5mb limit.",
        "",
        "Used by everything",
        (storageALLBSPSize + storageALLExceptBSPSize).toLocaleString('en-US') + "b",
        "",
        "Used by BSP Total",
        storageALLBSPSize.toLocaleString('en-US') + "b",
        "",
        "Used by BSP Predictions",
        storagePredictionSize.toLocaleString('en-US') + "b (Number : " + storagePredictionNumber + ")",
        "",
        "Used by BSP TornStats spies",
        storageTornStatsSize.toLocaleString('en-US') + "b (Number : " + storageTornStatsNumber + ")",
        "",
        "Used by BSP YATA spies",
        storageYATASize.toLocaleString('en-US') + "b (Number : " + storageYATANumber + ")",
        "",
        "Used by others = " + storageALLExceptBSPSize.toLocaleString('en-US') + "b",
        "(Torn chat = " + storageTornChatSize.toLocaleString('en-US') + "b)"
    ].join("\n");

    localStorageInfosDiv.appendChild(localStorageProgressBar);
    contentDiv.appendChild(localStorageInfosDiv);
    // </LocalStorage display>

    // <Export local storage>
    var divbuttonExportLocalCache = document.createElement("div");
    divbuttonExportLocalCache.className = "TDup_optionsTabContentDiv";
    var buttonExportLocalCache = document.createElement("input");
    buttonExportLocalCache.type = "button";
    buttonExportLocalCache.value = "Export BSP Local Storage";
    buttonExportLocalCache.className = "TDup_buttonInOptionMenu";

    buttonExportLocalCache.addEventListener("click", () => {
        buttonExportLocalCache.disabled = true;
        ExportPredictorStorage();
        buttonExportLocalCache.disabled = false;
    });

    divbuttonExportLocalCache.appendChild(buttonExportLocalCache);
    contentDiv.appendChild(divbuttonExportLocalCache);
    // </Export local storage>

    // <Test localStorage space>
    var divbuttonTestLocalStorageSpace = document.createElement("div");
    divbuttonTestLocalStorageSpace.className = "TDup_optionsTabContentDiv";
    var buttonTestLocalStorageSpace = document.createElement("input");
    buttonTestLocalStorageSpace.type = "button";
    buttonTestLocalStorageSpace.value = "Test Local Storage space";
    buttonTestLocalStorageSpace.className = "TDup_buttonInOptionMenu";

    buttonTestLocalStorageSpace.addEventListener("click", () => {
        buttonTestLocalStorageSpace.disabled = true;
        let result = TestLocalStorage();
        buttonTestLocalStorageSpace.disabled = false;
        buttonTestLocalStorageSpace.value = result == true ? "Success!" : "Failure, clear your cache";
    });

    divbuttonTestLocalStorageSpace.appendChild(buttonTestLocalStorageSpace);
    contentDiv.appendChild(divbuttonTestLocalStorageSpace);
    // </Export local storage>

    // <Test localStorage space>
    var divbuttonClearPredictions = document.createElement("div");
    divbuttonClearPredictions.className = "TDup_optionsTabContentDiv";
    let btnClearPredictions = document.createElement("input");
    btnClearPredictions.type = "button";
    btnClearPredictions.value = "Clear Predictions";
    btnClearPredictions.title = "Clear Predictions from Local Storage";
    btnClearPredictions.className = "TDup_buttonInOptionMenu";

    btnClearPredictions.addEventListener("click", () => {
        btnClearPredictions.disabled = true;
        if (confirm("BSP - IMPORTANT \r\n \r\nAre you sure you want to clear Predictions from BSP cache?") == true) {
            ClearCache(eStorageType.Prediction);
            window.location.reload();
        }
        btnClearPredictions.disabled = false;
    });

    divbuttonClearPredictions.appendChild(btnClearPredictions);
    contentDiv.appendChild(divbuttonClearPredictions);
    // </Clear TornStats spies>

    // <Clear TornStats spies>
    var divbuttonClearTornStatsSpies = document.createElement("div");
    divbuttonClearTornStatsSpies.className = "TDup_optionsTabContentDiv";
    let btnClearTornStatsSpies = document.createElement("input");
    btnClearTornStatsSpies.type = "button";
    btnClearTornStatsSpies.value = "Clear TornStats Spies";
    btnClearTornStatsSpies.title = "Clear BSP TornStats Spies from Local Storage";
    btnClearTornStatsSpies.className = "TDup_buttonInOptionMenu";

    btnClearTornStatsSpies.addEventListener("click", () => {
        btnClearTornStatsSpies.disabled = true;
        if (confirm("BSP - IMPORTANT \r\n \r\nAre you sure you want to clear TornStats spies from BSP cache?") == true) {
            ClearCache(eStorageType.TornStatsSpies);
            window.location.reload();
        }
        btnClearTornStatsSpies.disabled = false;
    });

    divbuttonClearTornStatsSpies.appendChild(btnClearTornStatsSpies);
    contentDiv.appendChild(divbuttonClearTornStatsSpies);
    // </Clear TornStats spies>

    // <Clear YATA spies>
    var divbuttonClearYATASpies = document.createElement("div");
    divbuttonClearYATASpies.className = "TDup_optionsTabContentDiv";
    let btnClearYATASpies = document.createElement("input");
    btnClearYATASpies.type = "button";
    btnClearYATASpies.value = "Clear YATA Spies";
    btnClearYATASpies.title = "Clear BSP YATA Spies from Local Storage";
    btnClearYATASpies.className = "TDup_buttonInOptionMenu";

    btnClearYATASpies.addEventListener("click", () => {
        btnClearYATASpies.disabled = true;
        if (confirm("BSP - IMPORTANT \r\n \r\nAre you sure you want to clear YATA spies from BSP cache?") == true) {
            ClearCache(eStorageType.YATASpies);
            window.location.reload();
        }
        btnClearYATASpies.disabled = false;
    });

    divbuttonClearYATASpies.appendChild(btnClearYATASpies);
    contentDiv.appendChild(divbuttonClearYATASpies);
    // </Clear YATA spies>

    // <Clear Chat Entries>
    var divbuttonClearChat = document.createElement("div");
    divbuttonClearChat.className = "TDup_optionsTabContentDiv";
    let btnClearTornChat = document.createElement("input");
    btnClearTornChat.type = "button";
    btnClearTornChat.value = "Clear Chat entries";
    btnClearTornChat.title = "Clear Chat entries from Local Storage";
    btnClearTornChat.className = "TDup_buttonInOptionMenu";

    btnClearTornChat.addEventListener("click", () => {
        btnClearTornChat.disabled = true;
        if (confirm("BSP - IMPORTANT \r\n \r\nAre you sure you want to clear Torn Chat entries your localstorage?") == true) {
            ClearCache(eStorageType.TornChat);
            window.location.reload();
        }
        btnClearTornChat.disabled = false;
    });

    divbuttonClearChat.appendChild(btnClearTornChat);
    contentDiv.appendChild(divbuttonClearChat);
    // </Clear Chat Entries>

    var divbuttonClearLocalCache = document.createElement("div");
    divbuttonClearLocalCache.className = "TDup_optionsTabContentDiv";
    var buttonClearLocalCache = document.createElement("input");
    buttonClearLocalCache.type = "button";
    buttonClearLocalCache.value = "Clear full BSP Local Storage";
    buttonClearLocalCache.title = "Clear full BSP Local Storage";
    buttonClearLocalCache.className = "TDup_buttonInOptionMenu";
    buttonClearLocalCache.style.backgroundColor = "red";

    buttonClearLocalCache.addEventListener("click", () => {
        buttonClearLocalCache.disabled = true;
        if (confirm("BSP - IMPORTANT \r\n \r\nAre you sure you want to clear BSP keys, stats, settings, spies and predictions from your local cache? \r\n \r\nIt will only impact this script: you will have to do the setup again (setup keys, import spies etc)") == true) {
            ClearCache(eStorageType.All);
            window.location.reload();
        }
        buttonClearLocalCache.disabled = false;
    });

    divbuttonClearLocalCache.appendChild(buttonClearLocalCache);
    contentDiv.appendChild(divbuttonClearLocalCache);

    // <Runtime diagnostics>
    let diagnosticsSection = document.createElement("div");
    diagnosticsSection.className = "TDup_optionsTabContentDiv";

    let diagnosticsTitle = document.createElement("div");
    diagnosticsTitle.textContent = "BSP Runtime Diagnostics";
    diagnosticsTitle.style.fontWeight = "bold";
    diagnosticsTitle.style.marginBottom = "8px";
    diagnosticsSection.appendChild(diagnosticsTitle);

    let diagnosticsConsole = document.createElement("textarea");
    diagnosticsConsole.readOnly = true;
    diagnosticsConsole.style.width = "100%";
    diagnosticsConsole.style.minHeight = "180px";
    diagnosticsConsole.style.fontFamily = "monospace";
    diagnosticsConsole.style.fontSize = "11px";
    diagnosticsConsole.style.whiteSpace = "pre";
    diagnosticsConsole.style.boxSizing = "border-box";
    diagnosticsSection.appendChild(diagnosticsConsole);

    function refreshDiagnosticsConsole() {
        diagnosticsConsole.value = BSPFormatDiagnosticsForDisplay(BSPGetDiagnosticsSnapshot(200));
    }

    let diagnosticsActions = document.createElement("div");
    diagnosticsActions.className = "TDup_optionsTabContentDivSmall";

    let refreshDiagnosticsBtn = document.createElement("input");
    refreshDiagnosticsBtn.type = "button";
    refreshDiagnosticsBtn.value = "Refresh Diagnostics";
    refreshDiagnosticsBtn.className = "TDup_buttonInOptionMenu";
    refreshDiagnosticsBtn.addEventListener("click", refreshDiagnosticsConsole);
    diagnosticsActions.appendChild(refreshDiagnosticsBtn);

    let exportDiagnosticsBtn = document.createElement("input");
    exportDiagnosticsBtn.type = "button";
    exportDiagnosticsBtn.value = "Export Diagnostics";
    exportDiagnosticsBtn.className = "TDup_buttonInOptionMenu";
    exportDiagnosticsBtn.addEventListener("click", function () {
        const payload = {
            exportedAt: new Date().toISOString(),
            scriptVersion: BSPGetScriptVersion(),
            diagnostics: BSPGetDiagnosticsSnapshot(1000),
            runtimeStatus: (typeof window !== "undefined" && window.__TDUP_BSP_LAST_STATUS__) ? window.__TDUP_BSP_LAST_STATUS__ : null,
            mutationMetrics: (typeof window !== "undefined" && window.__TDUP_BSP_MUTATION_METRICS__) ? window.__TDUP_BSP_MUTATION_METRICS__ : null,
            pageUrl: (typeof window !== "undefined" && window.location) ? window.location.href : ""
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "bsp-runtime-diagnostics-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
        link.click();
        URL.revokeObjectURL(link.href);
    });
    diagnosticsActions.appendChild(exportDiagnosticsBtn);

    let clearDiagnosticsBtn = document.createElement("input");
    clearDiagnosticsBtn.type = "button";
    clearDiagnosticsBtn.value = "Clear Diagnostics";
    clearDiagnosticsBtn.className = "TDup_buttonInOptionMenu";
    clearDiagnosticsBtn.addEventListener("click", function () {
        BSPClearDiagnostics();
        refreshDiagnosticsConsole();
    });
    diagnosticsActions.appendChild(clearDiagnosticsBtn);

    diagnosticsSection.appendChild(diagnosticsActions);
    contentDiv.appendChild(diagnosticsSection);
    refreshDiagnosticsConsole();

    // <Runtime self checks>
    let selfCheckSection = document.createElement("div");
    selfCheckSection.className = "TDup_optionsTabContentDiv";

    let selfCheckTitle = document.createElement("div");
    selfCheckTitle.textContent = "BSP Runtime Self Checks";
    selfCheckTitle.style.fontWeight = "bold";
    selfCheckTitle.style.marginBottom = "8px";
    selfCheckSection.appendChild(selfCheckTitle);

    let selfCheckResult = document.createElement("div");
    selfCheckResult.className = "TDup_optionsTabContentDivSmall";
    selfCheckResult.style.whiteSpace = "pre-line";
    selfCheckSection.appendChild(selfCheckResult);

    let runSelfChecksBtn = document.createElement("input");
    runSelfChecksBtn.type = "button";
    runSelfChecksBtn.value = "Run Self Checks";
    runSelfChecksBtn.className = "TDup_buttonInOptionMenu";
    runSelfChecksBtn.addEventListener("click", function () {
        const result = BSPRunSelfChecks();
        if (result.ok) {
            selfCheckResult.style.color = "green";
            selfCheckResult.textContent = "All checks passed (" + result.checkedAt + ").";
            BSPPushDiagnostic("info", "self-check-pass", "Runtime self checks passed", { checkedAt: result.checkedAt });
        } else {
            selfCheckResult.style.color = "red";
            selfCheckResult.textContent = "Self checks failed (" + result.checkedAt + "):\n- " + result.failures.join("\n- ");
            BSPLogError("self-check-failed", "Runtime self checks reported failures", { failures: result.failures, checkedAt: result.checkedAt });
        }
    });
    selfCheckSection.appendChild(runSelfChecksBtn);
    contentDiv.appendChild(selfCheckSection);
}

function BuildOptionMenu_Infos(menuArea, contentArea) {
    let contentDiv = BuildOptionMenu(menuArea, contentArea, "Infos", false);

    let TabContent_Content = document.createElement("div");
    TabContent_Content.className = "TDup_optionsTabContentDiv";
    TabContent_Content.textContent = "Script version : " + BSPGetScriptVersion();
    contentDiv.appendChild(TabContent_Content);

    let ForumThread = document.createElement("div");
    ForumThread.className = "TDup_optionsTabContentDiv";
    ForumThread.appendChild(document.createTextNode("Read basic setup, Q&A and R+ the script if you like it on the "));
    let forumThreadLink = document.createElement("a");
    forumThreadLink.href = "https://www.torn.com/forums.php#/p=threads&f=67&t=16290324&b=0&a=0&to=22705010";
    forumThreadLink.target = "_blank";
    forumThreadLink.rel = "noopener noreferrer";
    forumThreadLink.textContent = "Forum thread";
    ForumThread.appendChild(forumThreadLink);
    contentDiv.appendChild(ForumThread);

    let DiscordLink = document.createElement("div");
    DiscordLink.className = "TDup_optionsTabContentDiv";

    let DiscordText = document.createElement("div");
    DiscordText.appendChild(document.createTextNode("Give feedback, report bugs or just come to say hi on the "));
    let discordAnchor = document.createElement("a");
    discordAnchor.href = "https://discord.gg/zgrVX5j6MQ";
    discordAnchor.target = "_blank";
    discordAnchor.rel = "noopener noreferrer";
    discordAnchor.appendChild(document.createTextNode("Discord "));
    let discordImg = document.createElement("img");
    discordImg.width = 18;
    discordImg.height = 18;
    discordImg.title = "Discord";
    discordImg.src = "https://wiki.soldat.pl/images/6/6f/DiscordLogo.png";
    discordAnchor.appendChild(discordImg);
    DiscordText.appendChild(discordAnchor);
    DiscordLink.appendChild(DiscordText);

    contentDiv.appendChild(DiscordLink);

    let tips = document.createElement("div");
    tips.className = "TDup_optionsTabContentDiv";
    tips.appendChild(document.createTextNode("Tips :"));
    tips.appendChild(document.createElement("br"));
    tips.appendChild(document.createTextNode("You can click on the colored area to quick attack, from any screen!"));
    tips.appendChild(document.createElement("br"));
    let quickAttackImg = document.createElement("img");
    quickAttackImg.width = 200;
    quickAttackImg.src = "https://i.ibb.co/4TtQqzf/quick-Attack.png";
    tips.appendChild(quickAttackImg);
    tips.style.fontStyle = "italic";
    contentDiv.appendChild(tips);

    const ul = document.createElement("ul");
    ul.style = "list-style-type: none;padding: 0;";
    const items = [
        { urlImage: hofIcon, name: "Top 100 Hall Of Fame" },
        { urlImage: starIcon, name: "Your spy (TornStats or Yata)" },
        { urlImage: oldSpyIcon, name: "Old spy (that is displayed because prediction is lower than this)" },
        { urlImage: FFAttacksIcon, name: "Prediction using BSP user attack sharing (more reliable - BScore computed from FairFight)" },
    ];

    let legend = document.createElement("div");
    legend.className = "TDup_optionsTabContentDiv";
    legend.textContent = "Legend:";
    legend.style.fontStyle = "italic";
    contentDiv.appendChild(legend);

    items.forEach(item => {
        const li = document.createElement("li");
        li.style = "display: flex;align-items: center;margin-bottom: 8px;";

        const img = document.createElement("img");
        img.src = item.urlImage;
        img.width = 24;
        img.height = 24;
        img.style.marginRight = "8px";

        const span = document.createElement("span");
        span.textContent = item.name;

        li.appendChild(img);
        li.appendChild(span);

        ul.appendChild(li);
    });

    contentDiv.appendChild(ul);


}

function RefreshOptionMenuWithSubscription() {
    const pagesShouldBeHiddenWhenInactive = document.getElementsByClassName("TDup_tablinksShouldBeHiddenWhenInactive");
    let isValid = GetStorageBool(StorageKey.IsPrimaryAPIKeyValid) && IsSubscriptionValid();
    for (let i = 0; i < pagesShouldBeHiddenWhenInactive.length; i++) {
        pagesShouldBeHiddenWhenInactive[i].style.display = isValid ? "block" : "none";
    }
}

function BuildSettingsMenu(node) {
    if (!node) {
        node = document.querySelector(".content-title") || document.body;
    }
    if (!node) {
        BSPSetStatus("BSP could not build the settings window because no page anchor was found.", "warn", { code: "settings-menu-anchor-missing" });
        return;
    }
    let existingSettingsDiv = document.getElementById("TDup_PredictorOptionsDiv");
    if (existingSettingsDiv != undefined) {
        TDup_PredictorOptionsDiv = existingSettingsDiv;
        return;
    }

    LogInfo("Building BSP option window");
    TDup_PredictorOptionsDiv = document.createElement("div");
    TDup_PredictorOptionsDiv.id = "TDup_PredictorOptionsDiv";
    TDup_PredictorOptionsDiv.style.background = "lightgray";

    TDup_PredictorOptionsMenuArea = document.createElement("div");
    TDup_PredictorOptionsMenuArea.className = "TDup_optionsMenu";

    TDup_PredictorOptionsContentArea = document.createElement("div");

    var cell, table;
    table = document.createElement('table');
    table.style = 'width:100%; border:2px solid ' + GetColorTheme() + ';';

    let thead = table.createTHead();
    let rowHeader = thead.insertRow();
    let th = document.createElement("th");
    th.className = "TDup_optionsCellHeader";
    th.colSpan = 2;

    let imgDivTDup_PredictorOptionsDiv = document.createElement("div");
    let settingsImg = document.createElement("img");
    settingsImg.src = mainBSPIcon;
    settingsImg.style.maxWidth = "150px";
    settingsImg.style.maxHeight = "100px";
    settingsImg.style.verticalAlign = "middle";
    imgDivTDup_PredictorOptionsDiv.appendChild(settingsImg);
    imgDivTDup_PredictorOptionsDiv.appendChild(document.createTextNode(" Settings"));
    th.appendChild(imgDivTDup_PredictorOptionsDiv);

    rowHeader.appendChild(th);

    let raw = table.insertRow();
    cell = raw.insertCell();
    cell.className = "TDup_optionsCellMenu";
    cell.appendChild(TDup_PredictorOptionsMenuArea);

    cell = raw.insertCell();
    cell.appendChild(TDup_PredictorOptionsContentArea);
    TDup_PredictorOptionsDiv.appendChild(table);
    node.appendChild(TDup_PredictorOptionsDiv);

    BuildOptionMenu_Global(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea, true);
    BuildOptionMenu_Colors(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea);
    BuildOptionMenu_Pages(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea);
    BuildOptionMenu_Uploadstats(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea);
    BuildOptionMenu_YATA(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea);
    BuildOptionMenu_TornStats(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea);
    BuildOptionMenu_Debug(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea);
    BuildOptionMenu_Infos(TDup_PredictorOptionsMenuArea, TDup_PredictorOptionsContentArea);

    TDup_PredictorOptionsDiv.style.display = "none";

    // Get the element with id="defaultOpen" and click on it
    document.getElementById("TDup_tablinks_defaultOpen").click();

    RefreshOptionMenuWithSubscription();
    LogInfo("Building BSP option window done");
}

// #endregion

// #region Inject into pages

function InjectImportSpiesButton(node) {
    if (!node) return;

    if (!GetStorageBool(StorageKey.IsTornStatsAPIKeyValid)) return;

    mainNode = node;
    var topPageLinksList = node.querySelector("#top-page-links-list");
    if (topPageLinksList == undefined)
        topPageLinksList = node;

    var tdupDivBtnBspExists = topPageLinksList.querySelector(".TDup_divBtnBsp") !== null;
    if (tdupDivBtnBspExists) return;

    node.style.position = "relative";

    let btnImportTornStatsSpies = document.createElement("a");
    btnImportTornStatsSpies.className = "t-clear h c-pointer  line-h24 right TDup_divBtnBsp";
    let btnImportTornStatsSpiesContent = document.createElement("div");
    btnImportTornStatsSpiesContent.className = "TDup_button";
    btnImportTornStatsSpiesContent.textContent = "BSP Import Spies";
    btnImportTornStatsSpies.appendChild(btnImportTornStatsSpiesContent);

    let successImportTornStatsSpiesForFaction = document.createElement("label");
    successImportTornStatsSpiesForFaction.textContent = "Spies imported!";
    successImportTornStatsSpiesForFaction.style.color = 'green';
    successImportTornStatsSpiesForFaction.style.fontWeight = 'bold';
    successImportTornStatsSpiesForFaction.style.marginLeft = '8px';
    successImportTornStatsSpiesForFaction.style.visibility = "hidden";

    let errorImportTornStatsSpiesForFaction = document.createElement("label");
    errorImportTornStatsSpiesForFaction.textContent = "Error while fetching spies from TornStats";
    errorImportTornStatsSpiesForFaction.style.color = '#c0392b';
    errorImportTornStatsSpiesForFaction.style.fontWeight = 'bold';
    errorImportTornStatsSpiesForFaction.style.marginLeft = '8px';
    errorImportTornStatsSpiesForFaction.style.display = "none";

    const URLPage = new URL(window.location.href);
    let factionIdStr = URLPage.searchParams.get('ID');

    if (factionIdStr == undefined) {
        var el = document.querySelector('.faction-info');
        if (el != undefined) {
            factionIdStr = el.getAttribute("data-faction");
        }
        else {
            el = document.querySelector('.forum-thread');
            if (el != undefined && el.href != undefined) {
                let hrefArray = el.href.split('a=');
                if (hrefArray.length == 2) {
                    factionIdStr = hrefArray[1];
                }
            }
        }

    }

    el = document.querySelector('.view-wars');
    if (el != undefined) {

        let url = el.href;
        let hrefArray2 = url.split("ranked/");
        if (hrefArray2.length == 2) {
            factionIdStr = hrefArray2[1];
        }
    }

    FactionTargetId = parseInt(factionIdStr);

    if (FactionTargetId > 0) {
        btnImportTornStatsSpies.addEventListener("click", () => {
            btnImportTornStatsSpies.disabled = true;
            FetchFactionSpiesFromTornStats(FactionTargetId, btnImportTornStatsSpies, successImportTornStatsSpiesForFaction, errorImportTornStatsSpiesForFaction);
        });

        topPageLinksList.appendChild(btnImportTornStatsSpies);
        topPageLinksList.appendChild(successImportTornStatsSpiesForFaction);
        topPageLinksList.appendChild(errorImportTornStatsSpiesForFaction);
    }
}

var isBSPOptionDisplay = false;
function InjectOptionMenu(node) {
    if (!node)
        node = document;

    if (isBSPOptionDisplay)
        return;

    mainNode = node;
    var topPageLinksList = node.querySelector("#top-page-links-list");
    if (topPageLinksList == undefined)
        topPageLinksList = node;
    if (topPageLinksList.querySelector(".TDup_divBtnBsp[data-bsp-role='top-settings']"))
        return;

    //node.style.position = "relative";

    let btnOpenSettings = document.createElement("a");
    btnOpenSettings.className = "t-clear h c-pointer  line-h24 right TDup_divBtnBsp";
    btnOpenSettings.setAttribute("data-bsp-role", "top-settings");
    btnOpenSettings.appendChild(BSPBuildSettingsButtonContent("x-small", "16px"));

    btnOpenSettings.addEventListener("click", () => {
        if (TDup_PredictorOptionsDiv == undefined) {
            BuildSettingsMenu(document.querySelector(".content-title"));
        }

        if (TDup_PredictorOptionsDiv.style.display == "block") {
            TDup_PredictorOptionsDiv.style.display = "none";
        }
        else {
            TDup_PredictorOptionsDiv.style.display = "block";
            if (GetStorageBool(StorageKey.IsPrimaryAPIKeyValid)) {
                FetchUserDataFromBSPServer();
            }
        }
    });

    topPageLinksList.appendChild(btnOpenSettings);
    isBSPOptionDisplay = true;
}

function InjectBSPSettingsButtonInProfile(node) {
    if (!node)
        return;

    // Current Torn layouts can expose a very broad `.container.clearfix` wrapper.
    // Injecting there creates a giant banner-sized "Settings" button.
    if (node.id !== "sidebar" && typeof node.className === "string") {
        let classes = " " + node.className + " ";
        if (classes.includes(" container ") && classes.includes(" clearfix ")) {
            return;
        }
    }

    if (node.className.indexOf('mobile') !== -1) {
        OnMobile = true;
        return;
    }
    if (node.querySelector(".TDup_divBtnBsp[data-bsp-role='profile-settings']"))
        return;

    var btnOpenSettingsProfile = document.createElement("a");
    btnOpenSettingsProfile.className = "t-clear h c-pointer  line-h24 right TDup_divBtnBsp";
    btnOpenSettingsProfile.setAttribute("data-bsp-role", "profile-settings");
    btnOpenSettingsProfile.style.float = "none";
    btnOpenSettingsProfile.appendChild(BSPBuildSettingsButtonContent("large", "30px"));

    btnOpenSettingsProfile.addEventListener("click", () => {
        if (TDup_PredictorOptionsDiv == undefined) {
            BuildSettingsMenu(document.querySelector(".content-title"));
        }

        if (TDup_PredictorOptionsDiv.style.display == "block") {
            TDup_PredictorOptionsDiv.style.display = "none";
        }
        else {
            TDup_PredictorOptionsDiv.style.display = "block";
            if (GetStorageBool(StorageKey.IsPrimaryAPIKeyValid)) {
                FetchUserDataFromBSPServer();
            }
        }
    });

    ;
    if (node.children != undefined && node.children.length > 1)
        node.insertBefore(btnOpenSettingsProfile, node.children[1]);
    else
        node.appendChild(btnOpenSettingsProfile);
}

var statsAlreadyDisplayedOnProfile = false;
function InjectInProfilePage(isInit = true, node = undefined) {
    if (statsAlreadyDisplayedOnProfile)
        return;

    var mainContainer = document;

    var el;
    if (isInit == true) {
        mainContainer = document;
    }
    else if (node == undefined) {
        return;
    }
    else {
        mainContainer = node;
    }

    el = mainContainer.querySelectorAll('.buttons-wrap');
    if (el.length == 0)
        return;

    if (GetStorageBoolWithDefaultValue(StorageKey.IsShowingAlternativeProfileDisplay, false)) {
        el = document.querySelectorAll('.user-information');
    }

    if (ProfileTargetId == -1)
        return;

    if (el.length == 0)
        return;

    statsAlreadyDisplayedOnProfile = true;
    PlayerProfileDivWhereToInject = el[0];

    let profileId = GetStorage(StorageKey.PlayerId);
    if (profileId != undefined && profileId == ProfileTargetId) {
        if (GetStorageBoolWithDefaultValue(StorageKey.IsEnabledOnOwnProfile, false) == false) {
            return;
        }
    }

    AutoSyncTornStatsPlayer(ProfileTargetId);

    if (GetStorageBool(StorageKey.IsPrimaryAPIKeyValid)) {
        GetPredictionForPlayer(ProfileTargetId, OnProfilePlayerStatsRetrieved);
    }
}

function InjectInFactionPage(node) {
    if (!node) return;

    AutoSyncTornStatsFaction(FactionTargetId);

    let el = node.querySelectorAll('a');
    el = Array.from(el).filter(e => {
        if (!e || typeof e.closest !== "function") return false;
        if (e.closest('.raid-members-list')) return false; // Exclude raid.

        const descWrap = e.closest('.desc-wrap');
        if (descWrap && !descWrap.matches('[class*="warDesc"]')) return false; // Exclude walls.

        return true;
    });
    for (let i = 0; i < el.length; ++i) {
        var isDone = false;
        var iter = el[i];
        if (iter.href != null) {
            //"https://www.torn.com/profiles.php?XID=2139172"
            var myArray = iter.href.split("?XID=");
            if (myArray.length == 2) {
                let playerId = parseInt(myArray[1]);
                let isWall = iter.className == "user name ";

                if (iter.rel == "noopener noreferrer" || isWall == true) {
                    if (!(playerId in dictDivPerPlayer)) {
                        dictDivPerPlayer[playerId] = new Array();
                    }
                    dictDivPerPlayer[playerId].push(iter);
                    GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForGrid);
                    isDone = true;
                }

                for (var j = 0; j < iter.children.length; ++j) {
                    if (isDone) {
                        break;
                    }
                    var children = iter.children[j];
                    for (var k = 0; k < children.children.length; ++k) {

                        if (children != undefined && children.tagName != undefined && children.tagName == "IMG") {
                            if (!(playerId in dictDivPerPlayer)) {
                                dictDivPerPlayer[playerId] = new Array();
                            }
                            dictDivPerPlayer[playerId].push(children);
                            GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForGrid);
                            isDone = true;
                            break;
                        }
                        else {
                            var subChildren = children.children[k];
                            if (subChildren != undefined && subChildren.tagName != undefined && subChildren.tagName == "IMG") {
                                if (!(playerId in dictDivPerPlayer)) {
                                    dictDivPerPlayer[playerId] = new Array();
                                }

                                dictDivPerPlayer[playerId].push(children);
                                GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForGrid);
                                isDone = true;
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    if (GetStorageBoolWithDefaultValue(StorageKey.HasSortByBSPButtonsOnFactionPage, true)) {
        InjectSortButtons(node);
    }
}

function InjectInBountyPagePage(isInit, node) {
    var el;
    if (isInit == true) {
        el = document.querySelectorAll('.target.left')
    }
    else if (node == undefined) {
        return;
    }
    else {
        el = node.querySelectorAll('.target.left')
    }

    for (let i = 0; i < el.length; ++i) {
        var iter = el[i];
        var children = iter.children;
        var myArray = children[0].href.split("?XID=");
        if (myArray.length == 2) {
            var playerId = parseInt(myArray[1]);
            if (!(playerId in dictDivPerPlayer)) {
                dictDivPerPlayer[playerId] = new Array();
            }

            dictDivPerPlayer[playerId].push(iter);
            GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForGrid);
        }
    }
}

function InjectInGenericGridPageNewTornFormat(isInit, node) {
    var targetLinks;
    if (isInit == true) {
        targetLinks = document.querySelectorAll('a[href^="/profiles.php?"]');
    }
    else {
        targetLinks = node.querySelectorAll('a[href^="/profiles.php?"]');
    }

    targetLinks.forEach(targetLink => {

        let url = new URL(targetLink.href, window.location.origin);
        let playerId = url.searchParams.get('XID');

        if (playerId == undefined)
            return;

        let parentN = targetLink.parentNode;

        if (parentN == undefined)
            return;

        if (parentN.className == undefined)
            return;

        if (parentN.className.includes('honorWrap')) {
            if (!(playerId in dictDivPerPlayer)) {
                dictDivPerPlayer[playerId] = new Array();
            }

            dictDivPerPlayer[playerId].push(parentN);
            GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForGrid);
        }
    });
}

function InjectInEliminationPage(isInit, node) {
    var targetLinks;
    if (isInit == true) {
        targetLinks = document.querySelectorAll('a[href^="/profiles.php?"]');
    }
    else {
        targetLinks = node.querySelectorAll('a[href^="/profiles.php?"]');
    }

    targetLinks.forEach(targetLink => {

        let url = new URL(targetLink.href, window.location.origin);
        let playerId = url.searchParams.get('XID');

        if (playerId == undefined)
            return;

        let parentN = targetLink.parentNode;

        if (parentN == undefined)
            return;

        if (parentN.className == undefined)
            return;

        if (parentN.className.includes('dataGridData')) {

            const prevPlayerId = parentN.dataset.tdupPlayerId;
            if (prevPlayerId === String(playerId)) {
                return;
            }

            if (prevPlayerId) {
                if (dictDivPerPlayer[prevPlayerId]) {
                    dictDivPerPlayer[prevPlayerId] =
                        dictDivPerPlayer[prevPlayerId].filter(el => el !== parentN);
                }
                ClearInjectedStatsInCell(parentN);
            }

            parentN.dataset.tdupPlayerId = String(playerId);

            if (!(playerId in dictDivPerPlayer)) {
                dictDivPerPlayer[playerId] = [];
            }

            if (!dictDivPerPlayer[playerId].includes(parentN)) {
                dictDivPerPlayer[playerId].push(parentN);
            }

            GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForGrid);
        }
    });
}

function InjectInGenericGridPage(isInit, node) {
    // For pages with several players, grid format
    var el;
    if (isInit == true) {
        el = document.querySelectorAll('.user.name')
    }
    else {
        el = node.querySelectorAll('.user.name')
    }
    for (let i = 0; i < el.length; ++i) {
        var iter = el[i];
        var title = iter.title;

        var playerId = -1;
        let myArray = String(iter.textContent || "").split("[");
        if (myArray.length >= 2) {

            myArray = myArray[1].split("]");
            if (myArray.length >= 1) {
                playerId = parseInt(myArray[0]);
            }
        }

        if (playerId == -1) {
            if (iter.title != undefined) {
                let myArray2 = iter.title.split("[");
                if (myArray2.length >= 2) {

                    myArray2 = myArray2[1].split("]");
                    if (myArray2.length >= 1) {
                        playerId = parseInt(myArray2[0]);
                    }
                }
            }
        }

        if (playerId == -1)
            continue;

        var parentNode = iter.parentNode;
        var style = window.getComputedStyle(parentNode);
        if (style.display == "none")
            continue;

        var thisStyle = window.getComputedStyle(iter);
        if (thisStyle.width == "0px")
            continue;


        if (!(playerId in dictDivPerPlayer)) {
            dictDivPerPlayer[playerId] = new Array();
        }

        dictDivPerPlayer[playerId].push(iter);
        GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForGrid);
    }
}

var nodeForAttackPage;
function InjectInAttackPage(isInit, node) {

    if (isInit == true) {
        nodeForAttackPage = Array.from(document.querySelectorAll('*')).find(element =>
            String(element.className).includes('titleContainer')
        );
    }
    else {
        nodeForAttackPage = Array.from(node.querySelectorAll('*')).find(element =>
            String(element.className).includes('titleContainer')
        );
    }

    if (nodeForAttackPage) {
        const url = window.location.href;
        const urlObj = new URL(url);
        const playerId = urlObj.searchParams.get('user2ID');
        GetPredictionForPlayer(playerId, OnPlayerStatsRetrievedForAttackPage);
    }
}

function OnPlayerStatsRetrievedForAttackPage(targetId, prediction) {
    if (prediction == undefined) {
        BSPSetStatus("BSP could not fetch an attack-page prediction. Check API key/subscription/network status and reload.", "warn", { code: "attack-prediction-missing" });
        return;
    }
    if (nodeForAttackPage) {
        const removedOverlays = BSPRemoveExistingAttackStatsOverlays(nodeForAttackPage);
        if (removedOverlays > 0) {
            BSPSetStatus("Removed pre-existing BSP attack overlay(s) before drawing MV3 output. This usually means multiple BSP installs are active.", "warn", { code: "attack-overlay-deduped" });
        }
    }

    let spyMargin = '-5px 70px';

    let consolidatedData = GetConsolidatedDataForPlayerStats(prediction);
    let localBattleStats = GetLocalBattleStats();

    let colorComparedToUs;
    let formattedBattleStats;
    let FFPredicted = 0;

    let showScoreInstead = GetStorageBool(StorageKey.IsShowingBattleStatsScore);
    if (showScoreInstead == true) {
        let scoreRatio = 100 * consolidatedData.Score / localBattleStats.Score;
        colorComparedToUs = GetColorScoreDifference(scoreRatio);
        if (GetStorageBool(StorageKey.IsShowingBattleStatsPercentage)) {
            let ratioToDisplay = Math.min(999, scoreRatio);
            formattedBattleStats = ratioToDisplay.toFixed(0) + "%";
        }
        else {
            formattedBattleStats = FormatBattleStats(consolidatedData.Score);
        }

        FFPredicted = Math.min(1 + (8 / 3) * (consolidatedData.Score / localBattleStats.Score), 3);
        FFPredicted = FFPredicted.toFixed(2);
    }
    else {
        let tbsRatio = 100 * consolidatedData.TargetTBS / localBattleStats.TBS;
        colorComparedToUs = GetColorMaxValueDifference(tbsRatio);

        if (GetStorageBool(StorageKey.IsShowingBattleStatsPercentage)) {
            let ratioToDisplay = Math.min(999, tbsRatio);
            formattedBattleStats = ratioToDisplay.toFixed(0) + "%";
        }
        else {
            formattedBattleStats = FormatBattleStats(consolidatedData.TargetTBS);
        }
    }

    if (consolidatedData.Success == FAIL) {
        colorComparedToUs = "pink";
        formattedBattleStats = "Wait";
    } else if (consolidatedData.Success == MODEL_ERROR) {
        colorComparedToUs = "pink";
        formattedBattleStats = "Error";
    }

    let indicatorSrc = "";
    let titleText = '';
    if (consolidatedData.IsUsingSpy) {
        let FFPredicted = Math.min(1 + (8 / 3) * (consolidatedData.Score / localBattleStats.Score), 3);
        FFPredicted = Math.max(1, FFPredicted);
        FFPredicted = FFPredicted.toFixed(2);

        indicatorSrc = starIcon;
        titleText = 'Data coming from spy (' + String(consolidatedData.Spy.Source || "") + ') FF : ' + FFPredicted + ' ';
    }
    else if (consolidatedData.IsHOF) {
        indicatorSrc = hofIcon;
        titleText = "Stats coming from the Top 100 HOF forum thread";
    }
    else if (consolidatedData.isFFAttacks) {
        indicatorSrc = FFAttacksIcon;
        titleText = "Stats coming from BSP users attacks";
    }
    else if (consolidatedData.OldSpyStrongerThanPrediction) {
        indicatorSrc = oldSpyIcon;
        titleText = "Old spy having greater TBS than prediction -> showing old spy data instead";
    }
    else if (showScoreInstead) {
        titleText = "FF Predicted = " + FFPredicted;
    }

    let tipsDiv = document.createElement("div");
    tipsDiv.className = "TDup_AttackStatsInjectionDiv";
    tipsDiv.setAttribute("data-bsp-source", "mv3");

    if (indicatorSrc) {
        var attackIndicator = BSPCreateIndicatorImage(indicatorSrc, "13px", "13px", spyMargin);
        if (attackIndicator) {
            tipsDiv.appendChild(attackIndicator);
        }
    }

    let attackWrapper = document.createElement("div");
    attackWrapper.style.zIndex = "100";

    let attackStatsDiv = document.createElement("div");
    attackStatsDiv.className = "iconStatsAttack";
    if (titleText) {
        attackStatsDiv.title = titleText;
    }
    attackStatsDiv.style.background = BSPSafeCssColor(colorComparedToUs, "pink");
    attackStatsDiv.textContent = String(formattedBattleStats || "");
    attackWrapper.appendChild(attackStatsDiv);
    tipsDiv.appendChild(attackWrapper);

    nodeForAttackPage.appendChild(tipsDiv);

}

function SortPlayers(button, mainNode) {
    button.sortModeDesc = !button.sortModeDesc;
    button.isSorting = true;
    if (button.sortModeDesc) {
        BSPSetSortButtonLabel(button, "fa-arrow-up");
    }
    else {
        BSPSetSortButtonLabel(button, "fa-arrow-down");
    }

    let nodes = mainNode.querySelectorAll('.members-list'); // for war page
    if (nodes.length == 0)
        nodes = mainNode.querySelectorAll('.table-body'); // for faction page

    let nodeMain = nodes[0];
    var itemsArr = [];
    for (var i = 0; i < nodeMain.children.length; ++i) {
        itemsArr.push(nodeMain.children[i]);
    }

    itemsArr.sort(function (a, b) {
        let divA = a.querySelector('.iconStats');
        if (divA == undefined) {
            return 0;
        }
        let scoreA = parseInt(divA.getAttribute("data-bsp-stats"));
        let divB = b.querySelector('.iconStats');
        if (divB == undefined) {
            return 0;
        }
        let scoreB = parseInt(divB.getAttribute("data-bsp-stats"));

        let result = scoreA == scoreB
            ? 0
            : (scoreA > scoreB ? 1 : -1);

        if (!button.sortModeDesc) {
            result = -result;
        }
        return result;
    });

    for (let i = 0; i < itemsArr.length; ++i) {
        nodeMain.appendChild(itemsArr[i]);
    }
}


function InjectSortButtons(node) {
    var el = node.querySelectorAll('.members-cont');  // for war page

    if (el == undefined || el.children == 0 || el.length == 0) {
        el = node.querySelectorAll('.members-list'); // for faction page
        if (el == undefined || el.children == 0 || el.length == 0)
            return;
    }


    let buttonsArray = [];
    for (let i = 0; i < el.length; ++i) {
        let headerNode = el[i].querySelector('.member');
        if (headerNode == undefined || String(headerNode.textContent || "").includes("BSP"))
            continue;

        let btnSortMembers = document.createElement("button");
        btnSortMembers.sortModeDesc = true;
        btnSortMembers.isSorting = true;
        btnSortMembers.className = "TDup_buttonInOptionMenu";
        BSPSetSortButtonLabel(btnSortMembers, "fa-arrow-right");

        headerNode.insertBefore(btnSortMembers, headerNode.children[1]);

        buttonsArray.push({
            button: btnSortMembers,
            headerNode: headerNode
        });
    }

    for (let i = 0; i < buttonsArray.length; ++i) {
        buttonsArray[i].button.addEventListener("click", function (evt) {
            evt.stopPropagation();
            for (let j = 0; j < buttonsArray.length; ++j) {
                let { button, headerNode } = buttonsArray[j];
                SortPlayers(button, headerNode.parentNode.parentNode);
            }
        });
    }

}
// #endregion

// #region Script OnLoad
function InitColors() {
    for (var i = 0; i < LOCAL_COLORS.length; ++i) {
        LOCAL_COLORS[i] = BSPReadColorThreshold(i);
    }
}

function IsBSPEnabledOnCurrentPage() {
    for (const [, val] of Object.entries(PageType)) {
        if (IsPage(val)) {
            return GetStorageBool(StorageKey.IsBSPEnabledOnPage + val);
        }
    }
    return false;
}

function ClearInjectedStatsInCell(cell) {
    if (!cell) return;

    cell.querySelectorAll(
        '.TDup_ColoredStatsInjectionDiv, .TDup_ColoredStatsInjectionDivWithoutHonorBar'
    ).forEach(el => el.remove());
}

function BSPScheduleSettingsButtonHealthCheck() {
    setTimeout(function () {
        if (!IsPage(PageType.Profile))
            return;

        if (GetStorageBool(StorageKey.IsHidingBSPOptionButtonInToolbar))
            return;

        let hasProfileButton = document.querySelector(".TDup_divBtnBsp[data-bsp-role='profile-settings']") != undefined;
        let hasTopButton = document.querySelector(".TDup_divBtnBsp[data-bsp-role='top-settings']") != undefined;
        if (!hasProfileButton && !hasTopButton) {
            BSPSetStatus("BSP loaded but could not inject the Settings button. Torn's page layout may have changed.", "warn", { code: "settings-button-missing" });
        }
    }, 5000);
}

(function () {
    'use strict';
    BSPRegisterGlobalErrorHandlers();
    BSPSetBootstrapState("started", { version: BSPGetScriptVersion(), url: window.location.href });
    BSPPushDiagnostic("info", "bootstrap-start", "BSP bootstrap started", {
        version: BSPGetScriptVersion(),
        url: window.location.href
    });

    try {
        if (!BSPEnsureSingleton()) {
            BSPSetBootstrapState("aborted-duplicate", null);
            BSPPushDiagnostic("warn", "bootstrap-aborted-duplicate", "BSP bootstrap aborted due to duplicate instance", null);
            return;
        }
        BSPCheckInjectionMode();
        BSPDetectPreexistingBspUi();

        document.addEventListener('DOMContentLoaded', function () {
            try {
                if (styleInjected == false) {
                    var ref = document.querySelector('script');
                    if (ref != undefined && ref.parentNode != undefined) {
                        LogInfo("Style injected in DOMContentLoaded");
                        ref.parentNode.insertBefore(styleToAdd, ref);
                        styleInjected = true;
                    }
                }
            } catch (e) {
                BSPLogError("domcontentloaded-style-inject-failed", e, null);
            }
        });

        InitColors();

        if (!GetStorageBool(StorageKey.IsHidingBSPOptionButtonInToolbar)) {
            LogInfo("Inject Option Menu...");

            InjectBSPSettingsButtonInProfile(document.querySelector("#sidebar"));
            LogInfo("Inject Option Menu done.");
        }

        if (GetStorageBool(StorageKey.UploadDataAPIKeyIsValid) && GetStorageBool(StorageKey.UploadDataIsAutoMode)) {
            let dateNow = new Date();
            let dateSaved = new Date(GetStorage(StorageKey.UploadDataLastUploadTime));
            var time_difference = dateNow - dateSaved;
            var hours_difference = parseInt(time_difference / (1000 * 60 * 60));

            if (hours_difference > 24) {
                LogInfo("Auto update attacks (once a day)");
                CallBSPUploadStats(undefined);
            }
        }

        if (IsPage(PageType.Profile))
            InjectOptionMenu(document.querySelector(".content-title"));

        if (IsPage(PageType.Elimination)) // To remove after Elim. Little hack to force enable elimination injection without user having to open BSP Settings.
            GetStorageBoolWithDefaultValue(StorageKey.IsBSPEnabledOnPage + PageType.Elimination, true);

        if (window.location.href.startsWith("https://www.torn.com/factions.php")) {
            InjectImportSpiesButton(document.querySelector(".content-title"));
        }

        if (!IsSubscriptionValid()) {
            LogInfo("BSP Subscription invalid");
            BSPSetStatus("BSP subscription is expired or has not refreshed yet. Open BSP Settings on your profile page to check/update it.", "warn", { code: "subscription-invalid" });
            BSPSetBootstrapState("aborted-subscription-invalid", null);
            return;
        }

        if (!IsBSPEnabledOnCurrentPage()) {
            LogInfo("BSP disabled on current page");
            BSPSetStatus("BSP is disabled on this page (see BSP Settings > Pages).", "info", { code: "bsp-disabled-page" });
            BSPSetBootstrapState("aborted-page-disabled", null);
            return;
        }

        // Cleanup outdated cache so we don't burst the 5mo limit of the localstorage with old & useless predictions that would be renewed anyway on demand.
        ClearOutdatedPredictionInCache();
        ClearOutdatedSpiesInCache();

        // Auto import stats daily (if option is enabled)
        AutoImportStats();

        const pageFlags = {
            isProfile: IsPage(PageType.Profile),
            isEliminationMain: IsPage(PageType.Elimination) && !IsPage(PageType.EliminationRevenge),
            isFactionOrWar: IsPage(PageType.Faction) || IsPage(PageType.War),
            isFactionRoute: window.location.href.startsWith("https://www.torn.com/factions.php"),
            isNewGridPage: IsPage(PageType.HallOfFame) || IsPage(PageType.Market) || IsPage(PageType.Friends) || IsPage(PageType.Enemies) || IsPage(PageType.Targets) || IsPage(PageType.RussianRoulette) || IsPage(PageType.EliminationRevenge),
            isBounty: IsPage(PageType.Bounty),
            isAttack: IsPage(PageType.Attack)
        };
        BSPPushDiagnostic("info", "bootstrap-page-flags", "BSP page mode resolved", pageFlags);

        const BSP_MUTATION_FLUSH_MS = 80;
        const BSP_MUTATION_QUEUE_MAX = 500;
        const BSP_MUTATION_METRICS = { batches: 0, nodes: 0, lastBatchMs: 0 };
        const mutationNodeQueue = new Set();
        let mutationFlushTimer = null;
        let mutationQueueOverflowed = false;

        function BSPInjectTopUiIfNeeded() {
            if (pageFlags.isProfile && !GetStorageBool(StorageKey.IsHidingBSPOptionButtonInToolbar)) {
                InjectBSPSettingsButtonInProfile(document.querySelector("#sidebar"));
                InjectOptionMenu(document.querySelector(".content-title"));
            }
            if (pageFlags.isFactionRoute) {
                InjectImportSpiesButton(document.querySelector(".content-title"));
            }
        }

        function BSPInjectForNode(node, isInit) {
            if (!isInit && (!node || !node.querySelector)) {
                return;
            }

            if (pageFlags.isProfile) {
                InjectInProfilePage(isInit, node);
            }
            else if (pageFlags.isEliminationMain) {
                InjectInEliminationPage(isInit, node);
            }
            else if (pageFlags.isFactionOrWar) {
                InjectInFactionPage(node);
            }
            else if (pageFlags.isNewGridPage) {
                InjectInGenericGridPageNewTornFormat(isInit, node);
            }
            else if (pageFlags.isBounty) {
                InjectInBountyPagePage(isInit, node);
            }
            else if (pageFlags.isAttack) {
                InjectInAttackPage(isInit, node);
            }
            else {
                InjectInGenericGridPage(isInit, node);
            }
        }

        function BSPCollectMutationNodes(mutations, includeTargets) {
            const toProcess = new Set();
            mutations.forEach(function (mutation) {
                for (const node of mutation.addedNodes) {
                    if (node && node.nodeType === 1) {
                        toProcess.add(node);
                    }
                }
                if (includeTargets && (mutation.type === 'attributes' || mutation.type === 'characterData')) {
                    let target = mutation.target && mutation.target.nodeType === 1 ? mutation.target : mutation.target && mutation.target.parentElement;
                    if (target && target.nodeType === 1) {
                        toProcess.add(target);
                    }
                }
            });
            return toProcess;
        }

        function BSPFlushMutationQueue() {
            mutationFlushTimer = null;
            if (mutationNodeQueue.size === 0) {
                return;
            }

            const batchStarted = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            const nodes = mutationQueueOverflowed ? [document] : Array.from(mutationNodeQueue);
            mutationNodeQueue.clear();
            const wasOverflowed = mutationQueueOverflowed;
            mutationQueueOverflowed = false;

            BSPInjectTopUiIfNeeded();
            for (let i = 0; i < nodes.length; i++) {
                BSPInjectForNode(nodes[i], false);
            }

            const batchEnded = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
            BSP_MUTATION_METRICS.batches += 1;
            BSP_MUTATION_METRICS.nodes += nodes.length;
            BSP_MUTATION_METRICS.lastBatchMs = Number((batchEnded - batchStarted).toFixed(2));
            try { window.__TDUP_BSP_MUTATION_METRICS__ = Object.assign({}, BSP_MUTATION_METRICS); } catch (_) { }
            if (nodes.length >= 100 || BSP_MUTATION_METRICS.lastBatchMs >= 200) {
                BSPPushDiagnostic("warn", "mutation-batch-heavy", "Heavy mutation batch processed", {
                    nodes: nodes.length,
                    elapsedMs: BSP_MUTATION_METRICS.lastBatchMs,
                    batches: BSP_MUTATION_METRICS.batches
                });
            }
            if (wasOverflowed) {
                BSPPushDiagnostic("warn", "mutation-queue-overflow", "Mutation queue overflowed; performed full document pass", {
                    queueMax: BSP_MUTATION_QUEUE_MAX
                });
            }
        }

        function BSPQueueMutationNodes(nodes) {
            if (!nodes) return;
            nodes.forEach(function (node) {
                if (node && node.nodeType === 1 && node.querySelector) {
                    if (mutationNodeQueue.size < BSP_MUTATION_QUEUE_MAX) {
                        mutationNodeQueue.add(node);
                    } else {
                        mutationQueueOverflowed = true;
                    }
                }
            });
            if (!mutationFlushTimer) {
                mutationFlushTimer = setTimeout(BSPFlushMutationQueue, BSP_MUTATION_FLUSH_MS);
            }
        }

        // Inject in already loaded page:
        if (pageFlags.isProfile) {
            InjectInProfilePage(true, undefined);
            setTimeout(InjectInProfilePage, 3000);
        }
        else if (pageFlags.isFactionOrWar) {
            //AutoSyncTornStatsFaction(factionId);
        }
        else if (pageFlags.isBounty) {
            InjectInBountyPagePage(true, undefined);
        }
        else if (pageFlags.isEliminationMain) {
            InjectInEliminationPage(true, undefined);
        }
        else if (pageFlags.isNewGridPage) {
            InjectInGenericGridPageNewTornFormat(true, undefined);
        }
        else if (pageFlags.isAttack) {
            InjectInAttackPage(true, undefined);
        }
        else {
            InjectInGenericGridPage(true, undefined);
        }

        // Elimination gets its own way of observing changes, because of how the page is built (virtualization)    
        if (pageFlags.isEliminationMain) {
            var observer = new MutationObserver(function (mutations, observer) {
                BSPQueueMutationNodes(BSPCollectMutationNodes(mutations, true));
            });

            observer.observe(document, {
                attributes: true,
                childList: true,
                characterData: true,
                subtree: true
            });

            BSPSetBootstrapState("ready", { page: window.location.href, mode: "elimination-observer" });
            return;
        }

        var observer = new MutationObserver(function (mutations, observer) {
            BSPQueueMutationNodes(BSPCollectMutationNodes(mutations, false));
        });

        var canonical = document.querySelector("link[rel='canonical']");
        if (canonical != undefined) {
            var hrefCanon = canonical.href;
            const urlParams = new URLSearchParams(hrefCanon);
            ProfileTargetId = urlParams.get('https://www.torn.com/profiles.php?XID');
        }
        else {
            const urlParams = new URL(window.location).searchParams;
            ProfileTargetId = urlParams.get('XID');
        }

        BSPScheduleSettingsButtonHealthCheck();
        observer.observe(document, { attributes: false, childList: true, characterData: false, subtree: true });
        BSPSetBootstrapState("ready", { page: window.location.href, mode: "default-observer" });
        BSPPushDiagnostic("info", "bootstrap-ready", "BSP bootstrap completed", {
            page: window.location.href
        });
    } catch (e) {
        BSPSetBootstrapState("failed", { page: window.location.href });
        BSPLogError("bootstrap-failed", e, { page: window.location.href });
        BSPSetStatus("BSP failed during startup. Open console and inspect [BSP] diagnostics.", "error", {
            code: "bootstrap-failed",
            context: { hint: BSPGetMv3RemediationHint() }
        });
    }

})();

// #endregion

// #region API BSP

function FetchUserDataFromBSPServer() {
    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : FetchUserDataFromBSPServer - No focus, aborting");
        return;
    }
    let primaryAPIKey = GetStorage(StorageKey.PrimaryAPIKey);
    if (primaryAPIKey == undefined || primaryAPIKey == "") {
        LogInfo("BSP : Calling FetchUserDataFromBSPServer with primaryAPIKey undefined or empty, aborting");
        return;
    }

    return new Promise((resolve, reject) => {
        BSPXmlHttpRequest({
            method: 'GET',
            url: BSPNoCacheUrl(`${GetBSPServer()}/battlestats/user/${GetStorage(StorageKey.PrimaryAPIKey)}/${BSPGetScriptVersion()}`),
            headers: {
                'Content-Type': 'application/json'
            },
            onload: (response) => {
                try {
                    const appendBreak = (node, count = 1) => {
                        for (let b = 0; b < count; b++) {
                            node.appendChild(document.createElement("br"));
                        }
                    };
                    const appendRenewalInstructions = (node) => {
                        node.appendChild(document.createTextNode("You can extend it for 1xan/15days."));
                        appendBreak(node);
                        node.appendChild(document.createTextNode("Send directly to "));
                        let tdupLink = document.createElement("a");
                        tdupLink.style.display = "inline-block";
                        tdupLink.href = "https://www.torn.com/profiles.php?XID=2660552";
                        tdupLink.textContent = "TDup[2660552]";
                        node.appendChild(tdupLink);
                        node.appendChild(document.createTextNode(". Process is automated and treated within a minute."));
                        appendBreak(node);
                        node.appendChild(document.createTextNode("You can send in bulk. Dont use trade or parcels!"));
                    };

                    let result = BSPNormalizeBspUserDataResponse(
                        BSPParseResponseJson(response, "bsp-user-data"),
                        "bsp-user-data"
                    );

                    SetStorage(StorageKey.DateSubscriptionEnd, result.SubscriptionEnd);

                    if (result.SubscriptionActive) {
                        var dateNow = new Date();
                        var offsetInMinute = dateNow.getTimezoneOffset();
                        var dateSubscriptionEnd = new Date(result.SubscriptionEnd);
                        dateSubscriptionEnd.setMinutes(dateSubscriptionEnd.getMinutes() - offsetInMinute);
                        var time_difference = dateSubscriptionEnd - dateNow;
                        var days_difference = parseInt(time_difference / (1000 * 60 * 60 * 24));
                        var hours_difference = parseInt(time_difference / (1000 * 60 * 60));
                        hours_difference %= 24;
                        var minutes_difference = parseInt(time_difference / (1000 * 60));
                        minutes_difference %= 60;

                        subscriptionEndText.textContent = "";
                        let activeMessage = document.createElement("div");
                        activeMessage.style.color = BSPSafeCssColor(GetColorTheme(), mainColor);
                        activeMessage.appendChild(document.createTextNode("Thank you for using Battle Stats Predictor (BSP) script!"));
                        appendBreak(activeMessage, 2);

                        let expiryMessage = document.createElement("div");
                        expiryMessage.style.fontWeight = "bolder";
                        expiryMessage.textContent =
                            "Your subscription expires in "
                            + parseInt(days_difference) + " day" + (days_difference > 1 ? "s" : "") + ", "
                            + parseInt(hours_difference) + " hour" + (hours_difference > 1 ? "s" : "") + ", "
                            + parseInt(minutes_difference) + " minute" + (minutes_difference > 1 ? "s" : "") + ".";
                        activeMessage.appendChild(expiryMessage);
                        appendBreak(activeMessage);
                        appendRenewalInstructions(activeMessage);
                        subscriptionEndText.appendChild(activeMessage);

                    }
                    else {
                        subscriptionEndText.textContent = "";
                        let inactiveMessage = document.createElement("div");
                        inactiveMessage.style.color = "red";
                        inactiveMessage.appendChild(document.createTextNode("WARNING - Your subscription has expired."));
                        appendBreak(inactiveMessage);
                        appendRenewalInstructions(inactiveMessage);
                        subscriptionEndText.appendChild(inactiveMessage);
                    }

                    let sharingAttackInfoDiv = document.createElement("div");
                    sharingAttackInfoDiv.className = "TDup_optionsTabContentDiv";

                    let textToDisplay = '';
                    if (result.SubscriptionState == 1) {
                        if (GetStorageBool(StorageKey.UploadDataAPIKeyIsValid) && GetStorageBool(StorageKey.UploadDataIsAutoMode)) {
                            textToDisplay = "Thanks for sharing your attack logs - it helps BSP being more accurate <3;";
                        }
                        else {
                            textToDisplay = "Thanks for sharing your attack logs in the past! You can enable it again in the Upload Data section to help BSP become more accurate <3;";
                        }
                    }
                    else {
                        if (GetStorageBool(StorageKey.UploadDataAPIKeyIsValid) && GetStorageBool(StorageKey.UploadDataIsAutoMode)) {
                            textToDisplay = 'Thanks for sharing your attack logs, it helps BSP being more accurate. You will receive 3 months of subscription time once a valid attack is uploaded (a fight less than 48 hours old with a FairFight value below 3.0)';
                        }
                        else {
                            textToDisplay = "Help BSP be more accurate by uploading your attacks and get 3 months of free subscription time!\nTo do so, go to the Upload Data section and enable it.\nYour subscription time will be credited once you upload your first usable data(a fight less than 48 hours old with a FairFight value below 3.0).";
                        }
                    }

                    let sharingAttackInfoContent = document.createElement("div");
                    sharingAttackInfoContent.style.color = "#25ab1b";
                    sharingAttackInfoContent.style.whiteSpace = "pre-line";
                    sharingAttackInfoContent.textContent = textToDisplay;
                    sharingAttackInfoDiv.appendChild(sharingAttackInfoContent);

                    subscriptionEndText.appendChild(sharingAttackInfoDiv);

                    RefreshOptionMenuWithSubscription();
                    resolve(result);

                } catch (err) {
                    BSPLogError("fetch-user-data-parse-failed", err, { endpoint: "battlestats/user" });
                    reject(err);
                }
            },
            onerror: (err) => {
                BSPLogError("fetch-user-data-request-failed", err, { endpoint: "battlestats/user" });
                reject(err);
            }
        });
    });
}

function FetchScoreAndTBS(targetId) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : FetchScoreAndTBS - No focus, aborting");
        return;
    }

    let primaryAPIKey = GetStorage(StorageKey.PrimaryAPIKey);
    if (primaryAPIKey == undefined || primaryAPIKey == "") {
        LogInfo("BSP : Calling FetchScoreAndTBS with primaryAPIKey undefined or empty, aborting");
        return;
    }

    return new Promise((resolve, reject) => {
        BSPXmlHttpRequest({
            method: 'GET',
            url: BSPNoCacheUrl(`${GetBSPServer()}/battlestats/${GetStorage(StorageKey.PrimaryAPIKey)}/${targetId}/${BSPGetScriptVersion()}`),
            headers: {
                'Content-Type': 'application/json'
            },
            onload: (response) => {
                try {
                    let result = BSPNormalizeBspPredictionResponse(
                        BSPParseResponseJson(response, "bsp-score"),
                        "bsp-score"
                    );
                    resolve(result);
                } catch (err) {
                    BSPLogError("fetch-score-parse-failed", err, { targetId: String(targetId || "") });
                    reject(err);
                }
            },
            onerror: (err) => {
                BSPLogError("fetch-score-request-failed", err, { targetId: String(targetId || "") });
                reject(err);
            }
        });
    });
}

function CallBSPUploadStats(callback) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : CallBSPUploadStats - No focus, aborting");
        return;
    }

    let uploadStatsAPIKey = GetStorage(StorageKey.UploadDataAPIKey);
    if (uploadStatsAPIKey == undefined || uploadStatsAPIKey == "") {
        LogInfo("BSP : Calling CallBSPUploadStats with uploadStatsAPIKey undefined or empty, aborting");
        return;
    }

    return new Promise((resolve, reject) => {
        BSPXmlHttpRequest({
            method: 'GET',
            url: `${GetBSPServer()}/battlestats/uploaddata/${GetStorage(StorageKey.UploadDataAPIKey)}/${BSPGetScriptVersion()}`,
            headers: {
                'Content-Type': 'application/json'
            },
            onload: (response) => {
                try {
                    let result = BSPNormalizeBspUploadResponse(
                        BSPParseResponseJson(response, "bsp-upload-stats"),
                        "bsp-upload-stats"
                    );
                    resolve(result);
                    SetStorage(StorageKey.UploadDataLastUploadTime, new Date());
                    if (result.Result == 0) {
                        BSPInvokeCallback(callback, [true, 'Success'], "upload-stats-result-0");
                    }
                    else if (result.Result == 2) { // WrongAPIKey
                        BSPInvokeCallback(callback, [false, 'API Key doesnt allow'], "upload-stats-result-2");
                    }
                    else if (result.Result == 3) { // CantGetBscore
                        BSPInvokeCallback(callback, [false, 'Cant get your gym stats'], "upload-stats-result-3");
                    }
                    else if (result.Result == 4) { // CantGetAttacks
                        BSPInvokeCallback(callback, [false, 'Cant get your attacks'], "upload-stats-result-4");
                    }
                    else {
                        BSPInvokeCallback(callback, [false, 'An error occurred'], "upload-stats-result-default");
                    }
                } catch (err) {
                    BSPLogError("upload-stats-parse-failed", err, null);
                    reject(err);
                    BSPInvokeCallback(callback, [false, 'An error occurred'], "upload-stats-parse-failed");
                }
            },
            onerror: (err) => {
                BSPLogError("upload-stats-request-failed", err, null);
                reject(err);
                BSPInvokeCallback(callback, [false, 'An error occurred'], "upload-stats-request-failed");
            }
        });
    });
}

// #endregion

// #region API Torn

function VerifyTornAPIKey(callback) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : VerifyTornAPIKey - No focus, aborting");
        return;
    }

    var urlToUse = "https://api.torn.com/v2/user/personalstats,profile?key=" + GetStorage(StorageKey.PrimaryAPIKey) + "&cat=all&comment=BSPAuth"
    BSPXmlHttpRequest({
        method: "GET",
        url: urlToUse,
        onload: (r) => {
            let j;
            try {
                j = BSPEnsureRecord(BSPParseResponseJson(r, "torn-verify-api"), "torn-verify-api");
            } catch (e) {
                BSPLogError("verify-torn-api-parse-failed", e, null);
                BSPInvokeCallback(callback, [false, "Couldn't check (unexpected response)"], "verify-torn-api-parse");
                return;
            }

            if (j.error && j.error.code > 0) {
                BSPInvokeCallback(callback, [false, j.error.error], "verify-torn-api-error");
                return;
            }

            if (j.status != undefined && !j.status) {
                BSPInvokeCallback(callback, [false, "unknown issue"], "verify-torn-api-status");
                return;
            }

            if (
                !j.personalstats ||
                !j.personalstats.attacking ||
                !j.personalstats.attacking.attacks ||
                j.personalstats.attacking.attacks.won === undefined
            ) {
                BSPInvokeCallback(callback, [false, "Cant get personaldata, make sure your API key has proper authorizations"], "verify-torn-api-personalstats");
                return;
            }

            const parsedPlayerId = BSPParseNumberish(j.player_id);
            if (Number.isFinite(parsedPlayerId) && parsedPlayerId > 0) {
                SetStorage(StorageKey.PlayerId, parseInt(parsedPlayerId, 10));
            }
            BSPInvokeCallback(callback, [true], "verify-torn-api-success");
            return;

        },
        onabort: () => BSPInvokeCallback(callback, [false, "Couldn't check (aborted)"], "verify-torn-api-abort"),
        onerror: () => BSPInvokeCallback(callback, [false, "Couldn't check (error)"], "verify-torn-api-error-callback"),
        ontimeout: () => BSPInvokeCallback(callback, [false, "Couldn't check (timeout)"], "verify-torn-api-timeout")
    })
}

function GetPlayerStatsFromTornAPI(callback) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : GetPlayerStatsFromTornAPI - No focus, aborting");
        return;
    }

    LogInfo("GetPlayerStatsFromTornAPI ... ");
    var urlToUse = "https://api.torn.com/user/?selections=battlestats&comment=BSPGetStats&key=" + GetStorage(StorageKey.BattleStatsAPIKey);
    BSPXmlHttpRequest({
        method: "GET",
        url: urlToUse,
        onload: (r) => {
            let j;
            try {
                j = BSPEnsureRecord(BSPParseResponseJson(r, "torn-get-battlestats"), "torn-get-battlestats");
            } catch (e) {
                BSPLogError("fetch-battlestats-parse-failed", e, null);
                BSPInvokeCallback(callback, [false, "Couldn't check (unexpected response)"], "fetch-battlestats-parse");
                return;
            }

            if (j.error && j.error.code > 0) {
                BSPInvokeCallback(callback, [false, j.error.error], "fetch-battlestats-error");
                return;
            }

            if (j.status != undefined && !j.status) {
                BSPInvokeCallback(callback, [false, "unknown issue"], "fetch-battlestats-status");
                return;
            }

            const strength = BSPParseNumberish(j.strength);
            const defense = BSPParseNumberish(j.defense);
            const speed = BSPParseNumberish(j.speed);
            const dexterity = BSPParseNumberish(j.dexterity);
            if (!Number.isFinite(strength) || !Number.isFinite(defense) || !Number.isFinite(speed) || !Number.isFinite(dexterity)) {
                BSPInvokeCallback(callback, [false, "Couldn't check (invalid battle stats payload)"], "fetch-battlestats-invalid-payload");
                return;
            }

            SetStorage(StorageKey.IsBattleStatsAPIKeyValid, true);
            ReComputeStats(parseInt(strength, 10), parseInt(defense, 10), parseInt(speed, 10), parseInt(dexterity, 10));
            LogInfo("GetPlayerStatsFromTornAPI done");

            BSPInvokeCallback(callback, [true], "fetch-battlestats-success");
        },
        onabort: () => { BSPInvokeCallback(callback, [false, "Couldn't check (aborted)"], "fetch-battlestats-abort"); },
        onerror: () => { BSPInvokeCallback(callback, [false, "Couldn't check (error)"], "fetch-battlestats-error-callback"); },
        ontimeout: () => { BSPInvokeCallback(callback, [false, "Couldn't check (timeout)"], "fetch-battlestats-timeout"); }
    })
}

// #endregion

// #region API TornStats
function VerifyTornStatsAPIKey(callback) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : VerifyTornStatsAPIKey - No focus, aborting");
        return;
    }

    return new Promise((resolve, reject) => {
        BSPXmlHttpRequest({
            method: 'GET',
            url: `https://www.tornstats.com/api/v2/${GetStorage(StorageKey.TornStatsAPIKey)}`,
            headers: {
                'Content-Type': 'application/json'
            },
            onload: (response) => {
                try {
                    var result = BSPEnsureRecord(BSPParseResponseJson(response, "tornstats-verify"), "tornstats-verify");
                    if (result.status === false) {
                        BSPInvokeCallback(callback, [false, result.message], "verify-tornstats-status");
                        resolve(false);
                        return;
                    }

                    BSPInvokeCallback(callback, [true], "verify-tornstats-success");
                    resolve(true);

                } catch (err) {
                    BSPLogError("verify-tornstats-parse-failed", err, null);
                    reject(err);
                }
            },
            onerror: (err) => {
                BSPLogError("verify-tornstats-request-failed", err, null);
                reject(err);
            }
        });
    });
}

var pageViewOnce = false;
function AutoSyncTornStatsFaction(factionId) {
    if (pageViewOnce == true)
        return;

    pageViewOnce = true;

    if (GetStorageBoolWithDefaultValue(StorageKey.IsAutoImportTornStatsSpies) == false)
        return;

    let lastDateAutoSyncThisFaction = GetStorage(StorageKey.AutoImportLastDateFaction + factionId);
    if (lastDateAutoSyncThisFaction != undefined) {
        let dateConsideredTooOld = new Date();
        dateConsideredTooOld.setDate(dateConsideredTooOld.getDate() - 15);
        if (new Date(lastDateAutoSyncThisFaction) > dateConsideredTooOld) {
            LogInfo("AutoSyncTornStatsFaction  - " + factionId + " - Too recent call in database, skipping");
            return;
        }
    }

    SetStorage(StorageKey.AutoImportLastDateFaction + factionId, new Date());
    LogInfo("AutoSyncTornStatsFaction  - " + factionId + " - Getting spies from faction..");
    return FetchFactionSpiesFromTornStats(factionId);
}

function AutoSyncTornStatsPlayer(playerId) {
    if (pageViewOnce == true)
        return;

    pageViewOnce = true;

    if (GetStorageBoolWithDefaultValue(StorageKey.IsAutoImportTornStatsSpies) == false)
        return;

    let lastDateAutoSyncThisFaction = GetStorage(StorageKey.AutoImportLastDatePlayer + playerId);
    if (lastDateAutoSyncThisFaction != undefined) {
        let dateConsideredTooOld = new Date();
        dateConsideredTooOld.setDate(dateConsideredTooOld.getDate() - 1);
        if (new Date(lastDateAutoSyncThisFaction) > dateConsideredTooOld) {
            LogInfo("AutoSyncTornStatsPlayer  - " + playerId + " - Too recent call in database, skipping");
            return;
        }
    }

    SetStorage(StorageKey.AutoImportLastDatePlayer + playerId, new Date());
    LogInfo("AutoSyncTornStatsPlayer  - " + playerId + " - Getting spies from player..");
    return FetchPlayerSpiesFromTornStats(playerId);
}

function FetchPlayerSpiesFromTornStats(playerId) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : FetchPlayerSpiesFromTornStats - No focus, aborting");
        return;
    }

    let urlToCall = "https://www.tornstats.com/api/v2/" + GetStorage(StorageKey.TornStatsAPIKey) + "/spy/user/" + playerId;

    return new Promise((resolve, reject) => {
        BSPXmlHttpRequest({
            method: 'GET',
            url: urlToCall,
            headers: {
                'Content-Type': 'application/json'
            },
            onload: (response) => {
                try {
                    var results = BSPEnsureRecord(BSPParseResponseJson(response, "tornstats-player-spy"), "tornstats-player-spy");
                    if (results.status === false) {
                        LogInfo("Error request: Spy not retrieved from TornStats for player " + playerId);
                        resolve(false);
                        return;
                    }

                    if (!results.spy || typeof results.spy !== "object") {
                        BSPLogError("fetch-player-spy-invalid-payload", "Missing spy object in TornStats response", { playerId: String(playerId || "") });
                        resolve(false);
                        return;
                    }

                    LogInfo("Spy retrieved from TornStats for player " + playerId);
                    let setSpyInCacheResult = SetTornStatsSpyInCache(playerId, results.spy);
                    if (setSpyInCacheResult == eSetSpyInCacheResult.Error) {
                        BSPLogError("fetch-player-spy-cache-failed", "Unable to cache TornStats spy payload", { playerId: String(playerId || "") });
                    }
                    OnProfilePlayerStatsRetrieved(playerId, GetTornStatsSpyFromCache(playerId));
                    resolve(setSpyInCacheResult !== eSetSpyInCacheResult.Error);

                } catch (err) {
                    BSPLogError("fetch-player-spy-parse-failed", err, { playerId: String(playerId || "") });
                    reject(err);
                }
            },
            onerror: (err) => {
                BSPLogError("fetch-player-spy-request-failed", err, { playerId: String(playerId || "") });
                reject(err);
            }
        });
    });
}

function FetchFactionSpiesFromTornStats(factionId, button, successElem, failedElem) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : FetchFactionSpiesFromTornStats - No focus, aborting");
        return;
    }

    return new Promise((resolve, reject) => {
        BSPXmlHttpRequest({
            method: 'GET',
            url: `https://www.tornstats.com/api/v2/${GetStorage(StorageKey.TornStatsAPIKey)}/spy/faction/${factionId}`,
            headers: {
                'Content-Type': 'application/json'
            },
            onload: (response) => {
                try {
                    if (button != undefined)
                        button.disabled = false;

                    var results = BSPEnsureRecord(BSPParseResponseJson(response, "tornstats-faction-spies"), "tornstats-faction-spies");
                    var isUI = successElem != undefined;

                    if (results.status === false) {
                        LogInfo("Error - TornStats");
                        if (isUI) {
                            failedElem.style.visibility = "visible";
                            failedElem.style.display = "inline-block";
                            failedElem.textContent = String(results.message || "Unknown TornStats error");
                            successElem.style.visibility = "hidden";
                        }
                        resolve(false);
                        return;
                    }

                    let factionMembers = results && results.faction && results.faction.members;
                    if (factionMembers == undefined || factionMembers == null) {
                        let errorText = "TornStats returned no faction members for faction " + factionId;
                        if (results != undefined && results.message != undefined) {
                            errorText += " (" + results.message + ")";
                        }
                        LogInfo(errorText);
                        if (isUI) {
                            failedElem.style.visibility = "visible";
                            failedElem.style.display = "inline-block";
                            failedElem.textContent = "TornStats returned 0 spies.";
                            successElem.style.visibility = "hidden";
                        }
                        resolve(false);
                        return;
                    }

                    let membersCount = 0;
                    let newSpiesAdded = 0;
                    let spyUpdated = 0;
                    let spyError = 0;
                    const factionMemberKeys = Object.keys(factionMembers);
                    for (let m = 0; m < factionMemberKeys.length; m++) {
                        var key = factionMemberKeys[m];
                        let factionMember = factionMembers[key];
                        if (!factionMember || typeof factionMember !== "object" || factionMember.spy == undefined) {
                            continue;
                        }
                        membersCount++;
                        let factionMemberId = factionMember.id;
                        if (!Number.isFinite(BSPParseNumberish(factionMemberId))) {
                            factionMemberId = key;
                        }
                        let setSpyInCacheResult = SetTornStatsSpyInCache(factionMemberId, factionMember.spy);
                        if (setSpyInCacheResult == eSetSpyInCacheResult.NewSpy) {
                            newSpiesAdded++;
                        }
                        else if (setSpyInCacheResult == eSetSpyInCacheResult.SpyUpdated) {
                            spyUpdated++;
                        }
                        else if (setSpyInCacheResult == eSetSpyInCacheResult.Error) {
                            spyError++;
                        }
                    }

                    if (!isUI && newSpiesAdded > 0) {
                        // OnPlayerStatsRetrievedForGrid(factionMember.id, GetTornStatsSpyFromCache(factionMember.id)); Doesnt work, because we prevent updating several times the grid format.. unfortunate!
                        window.location.reload();
                    }

                    let textToDisplay = membersCount + " spies fetched from TornStats. " + newSpiesAdded + " new spies added. " + spyUpdated + " spies updated. " + spyError + " errors";
                    LogInfo(textToDisplay);
                    if (isUI) {
                        failedElem.style.visibility = "hidden";
                        successElem.style.visibility = "visible";
                        successElem.style.display = "inline-block";
                        successElem.textContent = String(textToDisplay || "");
                    }
                    resolve({
                        membersCount: membersCount,
                        newSpiesAdded: newSpiesAdded,
                        spyUpdated: spyUpdated,
                        spyError: spyError
                    });
                } catch (err) {
                    BSPLogError("fetch-faction-spies-parse-failed", err, { factionId: String(factionId || "") });
                    reject(err);
                }
            },
            onerror: (err) => {
                BSPLogError("fetch-faction-spies-request-failed", err, { factionId: String(factionId || "") });
                reject(err);
            }
        });
    });
}

// #endregion

// #region API YATA

function FetchSpiesFromYata(callback) {

    if (!CanQueryAnyAPI()) {
        LogInfo("BSP : FetchSpiesFromYata - No focus, aborting");
        return;
    }

    return new Promise((resolve, reject) => {
        BSPXmlHttpRequest({
            method: 'GET',
            url: `https://yata.yt/api/v1/spies/?key=${GetStorage(StorageKey.YataAPIKey)}`,
            headers: {
                'Content-Type': 'application/json'
            },
            onload: (response) => {
                try {
                    var results = BSPEnsureRecord(BSPParseResponseJson(response, "yata-spies"), "yata-spies");

                    if (results.error != undefined) {
                        BSPInvokeCallback(callback, [false, results.error.error], "fetch-yata-error");
                        resolve(false);
                        return;
                    }

                    if (!results.spies || typeof results.spies !== "object") {
                        BSPInvokeCallback(callback, [false, 'An error occurred, invalid YATA spies payload'], "fetch-yata-invalid-payload");
                        resolve(false);
                        return;
                    }

                    let membersCount = 0;
                    let newSpiesAdded = 0;
                    let spyUpdated = 0;
                    let spyError = 0;
                    const spyKeys = Object.keys(results.spies);
                    for (let s = 0; s < spyKeys.length; s++) {
                        var key = spyKeys[s];
                        let spy = results.spies[key];
                        if (spy == undefined) {
                            continue;
                        }
                        membersCount++;
                        let setSpyInCacheResult = SetYataSpyInCache(key, spy);
                        if (setSpyInCacheResult == eSetSpyInCacheResult.NewSpy) {
                            newSpiesAdded++;
                        }
                        else if (setSpyInCacheResult == eSetSpyInCacheResult.SpyUpdated) {
                            spyUpdated++;
                        }
                        else if (setSpyInCacheResult == eSetSpyInCacheResult.Error) {
                            spyError++;
                        }
                    }

                    BSPInvokeCallback(callback, [true, "Success! " + membersCount + " spies fetched from YATA. " + newSpiesAdded + " new spies added. " + spyUpdated + " spies updated. " + spyError + " errors"], "fetch-yata-success");
                    resolve({
                        membersCount: membersCount,
                        newSpiesAdded: newSpiesAdded,
                        spyUpdated: spyUpdated,
                        spyError: spyError
                    });

                    return;


                } catch (err) {
                    BSPLogError("fetch-yata-spies-parse-failed", err, null);
                    reject(err);
                }
            },
            onerror: (err) => {
                BSPLogError("fetch-yata-spies-request-failed", err, null);
                reject(err);
            }
        });
    });
}


// #endregion

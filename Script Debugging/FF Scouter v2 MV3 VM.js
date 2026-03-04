// ==UserScript==
// @name         FF Scouter V2
// @namespace    Violentmonkey Scripts
// @match        https://www.torn.com/*
// @version      2.71
// @author       rDacted, Weav3r, xentac
// @description  Shows the expected Fair Fight score against targets and faction war status
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @connect      ffscouter.com
// @license      GPL-3.0
// @run-at       document-idle
// @require      https://code.jquery.com/jquery-3.7.1.min.js
// @sandbox      DOM
// ==/UserScript==
 
const FF_VERSION = "2.71";
const API_INTERVAL = 30000;
const FF_TARGET_STALENESS = 24 * 60 * 60 * 1000; // Refresh the target list every day
const TARGET_KEY = "ffscouterv2-targets";
const TARGET_INDEX_KEY = "ffscouterv2-target-index";
const CLEARED_TSC_KEY = "ffscouterv2-cleared-tsc-keys";
const memberCountdowns = {};
const MAX_REQUESTS_PER_MINUTE = 20;
let apiCallInProgressCount = 0;
let currentUserId = null;
 
const TOAST_ERROR = "error";
const TOAST_LOG = "log";

// Polyfills for GM_* functions if not available
if (typeof GM_addStyle === 'undefined') {
  var GM_addStyle = function(css) {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  };
}

if (typeof GM_setValue === 'undefined') {
  var GM_setValue = function(key, value) {
    localStorage.setItem('GM_' + key, JSON.stringify(value));
  };
}

if (typeof GM_getValue === 'undefined') {
  var GM_getValue = function(key, defaultValue) {
    const value = localStorage.getItem('GM_' + key);
    if (value === null) return defaultValue;
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  };
}

if (typeof GM_deleteValue === 'undefined') {
  var GM_deleteValue = function(key) {
    localStorage.removeItem('GM_' + key);
  };
}

if (typeof GM_listValues === 'undefined') {
  var GM_listValues = function() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('GM_')) {
        keys.push(key.substring(3));
      }
    }
    return keys;
  };
}

if (typeof GM_registerMenuCommand === 'undefined') {
  var GM_registerMenuCommand = function(name, callback, accessKey) {
    // No-op fallback - menu commands not supported without userscript manager
    console.log('[FF Scouter V2] GM_registerMenuCommand not available:', name);
  };
}

if (typeof GM_xmlhttpRequest === 'undefined') {
  var GM_xmlhttpRequest = function(details) {
    const fetchOptions = {
      method: details.method || 'GET',
      headers: details.headers || {},
    };
    if (details.data) {
      fetchOptions.body = details.data;
    }
    fetch(details.url, fetchOptions)
      .then(response => {
        return response.text().then(text => {
          const responseObj = {
            responseText: text,
            status: response.status,
            statusText: response.statusText,
            readyState: 4,
            responseHeaders: [...response.headers].map(([k, v]) => `${k}: ${v}`).join('\r\n'),
            finalUrl: response.url
          };
          if (details.onload) details.onload(responseObj);
        });
      })
      .catch(error => {
        if (details.onerror) details.onerror({ error: error });
      });
  };
}
 
let singleton = document.getElementById("ff-scouter-run-once");
if (!singleton) {
  console.log(`[FF Scouter V2] FF Scouter version ${FF_VERSION} starting`);
  GM_addStyle(`
            .ff-scouter-indicator {
            position: relative;
            display: block;
            padding: 0;
            }
 
            .ff-scouter-vertical-line-low-upper,
            .ff-scouter-vertical-line-low-lower,
            .ff-scouter-vertical-line-high-upper,
            .ff-scouter-vertical-line-high-lower {
            content: '';
            position: absolute;
            width: 2px;
            height: 30%;
            background-color: black;
            margin-left: -1px;
            }
 
            .ff-scouter-vertical-line-low-upper {
            top: 0;
            left: calc(var(--arrow-width) / 2 + 33 * (100% - var(--arrow-width)) / 100);
            }
 
            .ff-scouter-vertical-line-low-lower {
            bottom: 0;
            left: calc(var(--arrow-width) / 2 + 33 * (100% - var(--arrow-width)) / 100);
            }
 
            .ff-scouter-vertical-line-high-upper {
            top: 0;
            left: calc(var(--arrow-width) / 2 + 66 * (100% - var(--arrow-width)) / 100);
        }
 
            .ff-scouter-vertical-line-high-lower {
            bottom: 0;
            left: calc(var(--arrow-width) / 2 + 66 * (100% - var(--arrow-width)) / 100);
            }
     
            .ff-scouter-ff-visible {
              display: flex !important;
            }
 
            .ff-scouter-ff-hidden {
              display: none !important;
            }
 
            .ff-scouter-est-visible {
              display: flex !important;
            }
 
            .ff-scouter-est-hidden {
              display: none !important;
            }
 
            .ff-scouter-arrow {
            position: absolute;
            transform: translate(-50%, -50%);
            padding: 0;
            top: 0;
            left: calc(var(--arrow-width) / 2 + var(--band-percent) * (100% - var(--arrow-width)) / 100);
            width: var(--arrow-width);
            object-fit: cover;
            pointer-events: none;
            }
 
            .last-action-row {
                font-size: 11px;
                color: inherit;
                font-style: normal;
                font-weight: normal;
                text-align: center;
                margin-left: 8px;
                margin-bottom: 2px;
                margin-top: -2px;
                display: block;
            }
            .travel-status {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 2px;
                min-width: 0;
                overflow: hidden;
            }
            .torn-symbol {
                width: 16px;
                height: 16px;
                fill: currentColor;
                vertical-align: middle;
                flex-shrink: 0;
            }
            .plane-svg {
                width: 14px;
                height: 14px;
                fill: currentColor;
                vertical-align: middle;
                flex-shrink: 0;
            }
            .plane-svg.returning {
                transform: scaleX(-1);
            }
            .country-abbr {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
                flex: 0 1 auto;
                vertical-align: bottom;
            }
 
            /* FF Scouter CSS Variables */
            body {
                --ff-bg-color: #f0f0f0;
                --ff-alt-bg-color: #fff;
                --ff-border-color: #ccc;
                --ff-input-color: #ccc;
                --ff-text-color: #000;
                --ff-hover-color: #ddd;
                --ff-glow-color: #4CAF50;
                --ff-success-color: #4CAF50;
            }
 
            body.dark-mode {
                --ff-bg-color: #333;
                --ff-alt-bg-color: #383838;
                --ff-border-color: #444;
                --ff-input-color: #504f4f;
                --ff-text-color: #ccc;
                --ff-hover-color: #555;
                --ff-glow-color: #4CAF50;
                --ff-success-color: #4CAF50;
            }
 
            .ff-settings-accordion {
                margin: 10px 0;
                padding: 10px;
                background-color: var(--ff-bg-color);
                border: 1px solid var(--ff-border-color);
                border-radius: 5px;
            }
 
            .ff-settings-accordion summary {
                cursor: pointer;
            }
 
            .ff-settings-accordion div.ff-settings-body {
              margin-top: 10px;
            }
 
            .ff-settings-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 10px;
                margin-bottom: 10px;
                font-size: 1.2em;
                font-weight: bold;
                color: var(--ff-text-color);
            }
 
            .ff-settings-header-username {
                display: inline;
                font-style: italic;
                color: var(--ff-success-color);
            }
 
            .ff-settings-entry {
                display: flex;
                align-items: center;
                gap: 5px;
                margin-top: 10px;
                margin-bottom: 5px;
            }
 
            .ff-settings-entry p {
                margin: 0;
                color: var(--ff-text-color);
            }
 
            .ff-settings-input {
                width: 120px;
                padding: 5px;
                background-color: var(--ff-input-color);
                color: var(--ff-text-color);
                border: 1px solid var(--ff-border-color);
                border-radius: 3px;
            }
 
            .ff-settings-input.ff-blur {
                filter: blur(3px);
                transition: filter 0.5s;
            }
 
            .ff-settings-input.ff-blur:focus {
                filter: blur(0);
                transition: filter 0.5s;
            }
 
            .ff-settings-button {
                margin-right: 10px;
            }
 
            .ff-settings-button:last-child {
                margin-right: 0;
            }
 
            .ff-settings-glow {
                animation: ff-glow 1s infinite alternate;
                border-width: 3px;
            }
 
            @keyframes ff-glow {
                0% {
                    border-color: var(--ff-border-color);
                }
                100% {
                    border-color: var(--ff-glow-color);
                }
            }
 
            .ff-api-explanation {
                background-color: var(--ff-alt-bg-color);
                border: 1px solid var(--ff-border-color);
                border-radius: 8px;
                color: var(--ff-text-color);
                margin-bottom: 20px;
            }
 
            .ff-api-explanation a {
                color: var(--ff-success-color) !important;
                text-decoration: underline;
            }
 
            .ff-settings-label {
                color: var(--ff-text-color);
            }
 
            .ff-settings-section-header {
                color: var(--ff-text-color);
                margin-top: 20px;
                margin-bottom: 10px;
                font-weight: bold;
            }
 
            .ff-settings-entry-large {
                margin-bottom: 15px;
            }
 
            .ff-settings-entry-small {
                margin-bottom: 10px;
            }
 
            .ff-settings-entry-section {
                margin-bottom: 20px;
            }
 
            .ff-settings-label-inline {
                margin-right: 10px;
                min-width: 150px;
                display: inline-block;
            }
 
            .ff-settings-input-wide {
                width: 200px;
            }
 
            .ff-settings-input-narrow {
                width: 120px;
            }
 
            .ff-settings-checkbox {
                margin-right: 8px;
            }
 
            .ff-settings-button-large {
                padding: 8px 16px;
                font-size: 14px;
                font-weight: bold;
            }
 
            .ff-settings-button-container {
                margin-bottom: 20px;
                text-align: center;
            }
 
            .ff-api-explanation-content {
                padding: 12px 16px;
                font-size: 13px;
                line-height: 1.5;
            }
        `);
 
  var BASE_URL = "https://ffscouter.com";
  var BLUE_ARROW = "https://uploads.glasnost.dev/blue-arrow.svg";
  var GREEN_ARROW = "https://uploads.glasnost.dev/green-arrow.svg";
  var RED_ARROW = "https://uploads.glasnost.dev/red-arrow.svg";
 
  var rD_xmlhttpRequest;
  var rD_setValue;
  var rD_getValue;
  var rD_listValues;
  var rD_deleteValue;
  var rD_registerMenuCommand;
 
  // DO NOT CHANGE THIS
  // DO NOT CHANGE THIS
  var apikey = "###PDA-APIKEY###";
  // DO NOT CHANGE THIS
  // DO NOT CHANGE THIS
  if (apikey[0] != "#") {
    console.log("[FF Scouter V2] Adding modifications to support TornPDA");
    rD_xmlhttpRequest = function (details) {
      ffdebug("[FF Scouter V2] Attempt to make http request");
      if (details.method.toLowerCase() == "get") {
        return PDA_httpGet(details.url)
          .then(details.onload)
          .catch(
            details.onerror ??
              ((e) =>
                console.error("[FF Scouter V2] Generic error handler: ", e)),
          );
      } else if (details.method.toLowerCase() == "post") {
        return PDA_httpPost(
          details.url,
          details.headers ?? {},
          details.body ?? details.data ?? "",
        )
          .then(details.onload)
          .catch(
            details.onerror ??
              ((e) =>
                console.error("[FF Scouter V2] Generic error handler: ", e)),
          );
      } else {
        console.log("[FF Scouter V2] What is this? " + details.method);
      }
    };
    rD_setValue = function (name, value) {
      ffdebug("[FF Scouter V2] Attempted to set " + name);
      return localStorage.setItem(name, value);
    };
    rD_getValue = function (name, defaultValue) {
      var value = localStorage.getItem(name) ?? defaultValue;
      return value;
    };
    rD_listValues = function () {
      const keys = [];
      for (const key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          keys.push(key);
        }
      }
      return keys;
    };
    rD_deleteValue = function (name) {
      ffdebug("[FF Scouter V2] Attempted to delete " + name);
      return localStorage.removeItem(name);
    };
    rD_registerMenuCommand = function () {
      ffdebug("[FF Scouter V2] Disabling GM_registerMenuCommand");
    };
    rD_setValue("limited_key", apikey);
  } else {
    rD_xmlhttpRequest = GM_xmlhttpRequest;
    rD_setValue = GM_setValue;
    rD_getValue = GM_getValue;
    rD_listValues = GM_listValues;
    rD_deleteValue = GM_deleteValue;
    rD_registerMenuCommand = GM_registerMenuCommand;
  }
 
  class FFScouterCache {
    constructor(db_name) {
      this.db_name = db_name;
      this.db = null;
      this.db_version = 1;
 
      this.store_name = "cache";
 
      this.migrations = {
        1: (db, _) => {
          ffdebug("Starting 1");
          const store = db.createObjectStore(this.store_name, {
            keyPath: "player_id",
          });
          store.createIndex("expiry", ["expiry"], {
            unique: false,
          });
          ffdebug("Ending 1");
        },
      };
    }
 
    open = async () => {
      return new Promise((resolve, reject) => {
        const dbopen = window.indexedDB.open(this.db_name, this.db_version);
        dbopen.onerror = (event) => {
          showToast(`Error loading database: ${this.db_name}`);
          ffdebug(event);
          this.db = null;
          reject(dbopen.error);
        };
 
        dbopen.onsuccess = () => {
          this.db = dbopen.result;
          this.db.onversionchange = (event) => {
            const db = this.db;
            this.db = null;
            db.close();
          };
          resolve(dbopen.result);
        };
 
        dbopen.onupgradeneeded = (event) => {
          const db = event.target.result;
          const tx = event.target.transaction;
          const old_version = event.target.oldVersion;
          ffdebug(`Old version: ${old_version}`);
 
          db.onerror = (event) => {
            showToast(`Error loading database for upgrade: ${this.db_name}`);
            ffdebug(event);
            reject(db.error);
          };
 
          for (let i = (old_version ?? 0) + 1; i <= this.db_version; i++) {
            ffdebug(`migration: ${i}`);
            if (this.migrations[i]) {
              ffdebug("exists");
              this.migrations[i](db, tx);
            }
          }
        };
      });
    };
 
    update_cache = async (values) => {
      return new Promise(async (resolve, reject) => {
        if (!this.db) {
          await this.open();
        }
        const tx = this.db.transaction(this.store_name, "readwrite");
 
        tx.onerror = (event) => {
          showToast(`Error opening transaction for update_cache`);
          ffdebug(event);
          reject(tx.error);
        };
 
        tx.oncomplete = (event) => {
          resolve(event);
        };
 
        const store = tx.objectStore(this.store_name);
 
        const adds = [];
        for (const i of values) {
          const r = store.put(i);
          adds.push(r);
        }
 
        Promise.all(adds)
          .then(() => {
            tx.commit();
          })
          .catch((error) => {
            ffdebug("Error adding document to object store.");
            reject(error);
          });
      });
    };
 
    get = async (player_ids) => {
      return new Promise(async (resolve, reject) => {
        if (!this.db) {
          await this.open();
        }
        const tx = this.db.transaction(this.store_name, "readonly");
 
        tx.onerror = (event) => {
          showToast(`Error opening transaction for get: ${tx.error}`);
          ffdebug(event);
          ffdebug(tx.error);
          reject(tx.error);
        };
 
        const store = tx.objectStore(this.store_name);
 
        const promises = [];
        const results = {};
        for (const player_id of player_ids) {
          const res = store.get(player_id);
          promises.push(
            new Promise((resolve, reject) => {
              res.onerror = () => {
                reject(res.error);
              };
 
              res.onsuccess = () => {
                if (res.result && res.result.expiry > Date.now()) {
                  results[res.result.player_id] = res.result;
                }
                resolve();
              };
            }),
          );
        }
 
        Promise.all(promises)
          .then(() => {
            tx.commit();
            resolve(results);
          })
          .catch((error) => {
            showToast(`Error getting a player_id: ${error}`);
            ffdebug(error);
            reject(error);
          });
      });
    };
 
    clean_expired = () => {
      return new Promise(async (resolve, reject) => {
        if (!this.db) {
          await this.open();
        }
        const tx = this.db.transaction(this.store_name, "readwrite");
 
        tx.onerror = (event) => {
          showToast(`Error opening transaction for clean_expired: ${tx.error}`);
          ffdebug(event);
          ffdebug(tx.error);
          reject(tx.error);
        };
 
        const store = tx.objectStore(this.store_name);
        const index = store.index("expiry");
 
        const range = IDBKeyRange.upperBound(Date.now(), true);
 
        const r = index.getAllKeys(range);
        r.onerror = () => {
          reject(r.error);
        };
        r.onsuccess = () => {
          r.result.forEach((elem) => {
            store.delete(elem);
          });
 
          tx.commit();
          ffdebug(
            `[FF Scouter V2] Cleaned ${r.result.length} expired values from IndexedDB`,
          );
          resolve(r.result);
        };
      });
    };
 
    delete_db = async () => {
      return new Promise((resolve, reject) => {
        const r = window.indexedDB.deleteDatabase(this.db_name);
 
        r.onerror = () => {
          ffdebug(`Error deleting indexedDB (${this.db_name}): ${r.error}`);
          reject(r.error);
        };
 
        r.onsuccess = () => {
          ffdebug(`Successfully deleted indexedDB (${this.db_name})`);
          resolve(r.result);
        };
      });
    };
  }
 
  const ffcache = new FFScouterCache("ffscouter-cache");
 
  if (!rD_getValue(CLEARED_TSC_KEY)) {
    console.log("Trying to delete any TSC keys found");
    // Delete TSC data because they're not useful anymore
    const badkeys = [];
    for (var i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith("kwack.mavri.tsc.rocks")) {
        badkeys.push(key);
      }
    }
    console.log(`Found ${badkeys.length} TSC keys`);
    for (const key of badkeys) {
      localStorage.removeItem(key);
    }
    console.log("Deleted keys");
 
    rD_setValue(CLEARED_TSC_KEY, "true");
  }
 
  var key = rD_getValue("limited_key", null);
  var info_line = null;
 
  rD_registerMenuCommand("Enter Limited API Key", () => {
    let userInput = prompt(
      "[FF Scouter V2]: Enter Limited API Key",
      rD_getValue("limited_key", ""),
    );
    if (userInput !== null) {
      rD_setValue("limited_key", userInput);
      // Reload page
      window.location.reload();
    }
  });
 
  function inject_info_line(h4, info_line) {
    if (h4.textContent === "Attacking") {
      h4.parentNode.parentNode.after(info_line);
    } else {
      const linksTopWrap = h4.parentNode.querySelector(".links-top-wrap");
      if (linksTopWrap) {
        linksTopWrap.parentNode.insertBefore(
          info_line,
          linksTopWrap.nextSibling,
        );
      } else {
        h4.after(info_line);
      }
    }
  }
 
  function ffdebug(...args) {
    if (ffSettingsGet("debug-logs") == "true") {
      console.log(...args);
    }
  }
 
  function create_text_location() {
    info_line = document.createElement("div");
    info_line.id = "ff-scouter-run-once";
    info_line.style.display = "block";
    info_line.style.clear = "both";
    info_line.style.margin = "5px 0";
    if (!key) {
      info_line.style.cursor = "pointer";
    }
    info_line.addEventListener("click", () => {
      if (!key) {
        const limited_key = prompt(
          "[FF Scouter V2]: Enter Limited API Key",
          rD_getValue("limited_key", ""),
        );
        if (limited_key) {
          rD_setValue("limited_key", limited_key);
          key = limited_key;
          window.location.reload();
        }
      }
    });
 
    var h4 = $("h4")[0];
    if (!h4) {
      const obs = new MutationObserver(function () {
        var h4 = $("h4")[0];
        if (!h4) {
          return;
        }
 
        inject_info_line(h4, info_line);
        obs.disconnect();
      });
 
      obs.observe(document, {
        childList: true,
        subtree: true,
      });
    } else {
      inject_info_line(h4, info_line);
    }
 
    return info_line;
  }
 
  function reset_ff_ranges() {
    rD_deleteValue("ffscouterv2-ranges");
  }
 
  function set_ff_ranges(low, high, max) {
    rD_setValue(
      "ffscouterv2-ranges",
      JSON.stringify({ low: low, high: high, max: max }),
    );
  }
 
  function get_ff_ranges(noDefault) {
    const defaultRange = { low: 2, high: 4, max: 8 };
    const rangeUnparsed = rD_getValue("ffscouterv2-ranges");
    if (!rangeUnparsed) {
      if (noDefault) {
        return null;
      }
      return defaultRange;
    }
 
    try {
      const parsed = JSON.parse(rangeUnparsed);
      return parsed;
    } catch (error) {
      console.error(
        "[FF Scouter V2] Problem parsing configured range, reseting values.",
      );
      reset_ff_ranges();
      if (noDefault) {
        return null;
      }
      return defaultRange;
    }
  }
 
  function set_message(message, error = false) {
    while (info_line.firstChild) {
      info_line.removeChild(info_line.firstChild);
    }
 
    const textNode = document.createTextNode(message);
    if (error) {
      info_line.style.color = "red";
    } else {
      info_line.style.color = "";
    }
    info_line.appendChild(textNode);
  }
 
  let queued_player_ids = [];
  let queued_callbacks = [];
  let requests_this_minute = 0;
  let requests_rate_limit = 100;
  let requests_remaining = requests_rate_limit;
  let requests_reset_time = new Date(Date.now() + 60000);
 
  async function update_ff_cache(player_ids, callback) {
    if (!key) {
      return;
    }
 
    player_ids = [...new Set(player_ids)];
 
    clean_expired_data();
 
    var unknown_player_ids = await get_cache_misses(player_ids);
 
    if (unknown_player_ids.length > 0) {
      console.log(
        `[FF Scouter V2] Queuing ${unknown_player_ids.length} ids to update`,
      );
 
      queued_player_ids.push(...unknown_player_ids);
      queued_callbacks.push(callback);
    } else {
      callback(player_ids);
    }
  }
 
  // Process queued player ids
  async function process_queue() {
    if (queued_player_ids.length > 0) {
      const processing_player_ids = queued_player_ids;
      queued_player_ids = [];
      const callbacks = queued_callbacks;
      queued_callbacks = [];
      if (requests_reset_time - Date.now() <= 0) {
        requests_this_minute = 0;
        requests_remaining = requests_rate_limit;
        requests_reset_time = new Date(Date.now() + 60000);
      } else {
        requests_this_minute++;
        requests_remaining--;
      }
      await process_queued_player_ids(processing_player_ids, function () {
        for (const callback of callbacks) {
          callback(processing_player_ids);
        }
      });
    }
 
    let seconds_left = Math.floor((requests_reset_time - Date.now()) / 1000);
    if (seconds_left <= 0) {
      seconds_left = 60;
      requests_this_minute = 0;
      requests_remaining = requests_rate_limit;
      requests_reset_time = new Date(Date.now() + 60000);
    }
    ffdebug("[FF Scouter V2] Seconds left:", seconds_left);
 
    if (requests_remaining <= 0) {
      requests_remaining = 1;
    }
    ffdebug("[FF Scouter V2] Requests left:", requests_remaining);
 
    // Evenly space the requests left this minute across the entire minute
    let next_check = (seconds_left / requests_remaining) * 1000;
    // But allow the first 5 to burst in the first second
    if (requests_this_minute < requests_rate_limit * 0.25) {
      next_check = 1000;
    }
    ffdebug("[FF Scouter V2] Next check:", next_check);
    setTimeout(process_queue, next_check);
  }
  setTimeout(process_queue, 10);
 
  async function process_queued_player_ids(player_ids, callback) {
    if (!key) {
      return;
    }
 
    player_ids = [...new Set(player_ids)];
 
    clean_expired_data();
 
    var unknown_player_ids = await get_cache_misses(player_ids);
 
    if (unknown_player_ids.length > 0) {
      console.log(
        `[FF Scouter V2] Refreshing cache for ${unknown_player_ids.length} ids`,
      );
 
      var player_id_list = unknown_player_ids.join(",");
      const url = `${BASE_URL}/api/v1/get-stats?key=${key}&targets=${player_id_list}`;
 
      rD_xmlhttpRequest({
        method: "GET",
        url: url,
        onload: function (response) {
          if (!response) {
            // If the same request happens in under a second, Torn PDA will return nothing
            return;
          }
          if (response.status == 200) {
            var ff_response = JSON.parse(response.responseText);
            if (ff_response && ff_response.error) {
              showToast(ff_response.error);
              return;
            }
            var one_hour = 60 * 60 * 1000;
            var expiry = Date.now() + one_hour;
            const cachedObjs = [];
            ff_response.forEach((result) => {
              if (result && result.player_id) {
                if (result.fair_fight === null) {
                  let cacheObj = {
                    no_data: true,
                    expiry: expiry,
                    player_id: result.player_id,
                  };
                  cachedObjs.push(cacheObj);
                } else {
                  let cacheObj = {
                    value: result.fair_fight,
                    last_updated: result.last_updated,
                    expiry: expiry,
                    bs_estimate: result.bs_estimate,
                    bs_estimate_human: result.bs_estimate_human,
                    player_id: result.player_id,
                  };
                  cachedObjs.push(cacheObj);
                }
              }
            });
            ffcache.update_cache(cachedObjs).then(() => {
              callback(player_ids);
            });
 
            update_limits(response.responseHeaders);
          } else {
            try {
              var err = JSON.parse(response.responseText);
              if (err && err.error) {
                showToast(
                  "API request failed. Error: " +
                    err.error +
                    "; Code: " +
                    err.code,
                );
              } else {
                showToast(
                  "API request failed. HTTP status code: " + response.status,
                );
              }
            } catch {
              showToast(
                "API request failed. HTTP status code: " + response.status,
              );
            }
          }
        },
        onerror: function (e) {
          console.error("[FF Scouter V2] **** error ", e, "; Stack:", e.stack);
        },
        onabort: function (e) {
          console.error("[FF Scouter V2] **** abort ", e, "; Stack:", e.stack);
        },
        ontimeout: function (e) {
          console.error(
            "[FF Scouter V2] **** timeout ",
            e,
            "; Stack:",
            e.stack,
          );
        },
      });
    } else {
      callback(player_ids);
    }
  }
 
  function update_limits(responseHeaders) {
    ffdebug("responseHeaders:", responseHeaders);
    const headerLines = responseHeaders.split("\n");
    const headers = {};
    for (const line of headerLines) {
      const [key, value] = line.split(":", 2);
      headers[key] = value.trim();
    }
    ffdebug("headers:", headers);
    if (
      "x-ratelimit-reset-timestamp" in headers &&
      "x-ratelimit-remaining" in headers
    ) {
      requests_reset_time = new Date(
        parseInt(headers["x-ratelimit-reset-timestamp"]) * 1000,
      );
      requests_remaining = parseInt(headers["x-ratelimit-remaining"]);
      requests_rate_limit = parseInt(headers["x-ratelimit-limit"]);
      requests_this_minute = requests_rate_limit - requests_remaining;
    }
  }
 
  function clean_expired_data() {
    ffcache.clean_expired();
    let count = 0;
    for (const key of rD_listValues()) {
      // Try renaming the key to the new name format
      if (key.match(/^\d+$/)) {
        if (rename_if_ffscouter(key)) {
          if (clear_if_expired("ffscouterv2-" + key)) {
            count++;
          }
        }
      }
      if (key.startsWith("ffscouterv2-")) {
        if (clear_if_expired(key)) {
          count++;
        }
      }
    }
    ffdebug("[FF Scouter V2] Cleaned " + count + " expired values");
  }
 
  function rename_if_ffscouter(key) {
    const value = rD_getValue(key, null);
    if (value == null) {
      return false;
    }
    var parsed = null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
    if (parsed == null) {
      return false;
    }
    if ((!parsed.value && !parsed.no_data) || !parsed.expiry) {
      return false;
    }
 
    rD_setValue("ffscouterv2-" + key, value);
    rD_deleteValue(key);
    return true;
  }
 
  function clear_if_expired(key) {
    const value = rD_getValue(key, null);
    var parsed = null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
    if (
      parsed &&
      (parsed.value || parsed.no_data) &&
      parsed.expiry &&
      parsed.expiry < Date.now()
    ) {
      rD_deleteValue(key);
      return true;
    }
    return false;
  }
 
  async function display_fair_fight(target_id, player_id) {
    const response = await get_cached_value(target_id);
    if (response) {
      set_fair_fight(response, player_id);
    }
  }
 
  function get_ff_string(ff_response) {
    const ff = ff_response.value.toFixed(2);
 
    const now = Date.now() / 1000;
    const age = now - ff_response.last_updated;
 
    var suffix = "";
    if (age > 14 * 24 * 60 * 60) {
      suffix = "?";
    }
 
    return `${ff}${suffix}`;
  }
 
  function get_difficulty_text(ff) {
    if (ff <= 1) {
      return "Extremely easy";
    } else if (ff <= 2) {
      return "Easy";
    } else if (ff <= 3.5) {
      return "Moderately difficult";
    } else if (ff <= 4.5) {
      return "Difficult";
    } else {
      return "May be impossible";
    }
  }
 
  function get_detailed_message(ff_response, player_id) {
    if (ff_response.no_data || !ff_response.value) {
      return `<span style=\"font-weight: bold; margin-right: 6px;\">FairFight:</span><span style=\"background: #444; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 4px; display: inline-block;\">No data</span>`;
    }
    const ff_string = get_ff_string(ff_response);
    const difficulty = get_difficulty_text(ff_response.value);
 
    const now = Date.now() / 1000;
    const age = now - ff_response.last_updated;
 
    var fresh = "";
 
    if (age < 24 * 60 * 60) {
      // Pass
    } else if (age < 31 * 24 * 60 * 60) {
      var days = Math.round(age / (24 * 60 * 60));
      if (days == 1) {
        fresh = "(1 day old)";
      } else {
        fresh = `(${days} days old)`;
      }
    } else if (age < 365 * 24 * 60 * 60) {
      var months = Math.round(age / (31 * 24 * 60 * 60));
      if (months == 1) {
        fresh = "(1 month old)";
      } else {
        fresh = `(${months} months old)`;
      }
    } else {
      var years = Math.round(age / (365 * 24 * 60 * 60));
      if (years == 1) {
        fresh = "(1 year old)";
      } else {
        fresh = `(${years} years old)`;
      }
    }
 
    const background_colour = get_ff_colour(ff_response.value);
    const text_colour = get_contrast_color(background_colour);
 
    let statDetails = "";
    if (ff_response.bs_estimate_human) {
      statDetails = `<span style=\"font-size: 11px; font-weight: normal; margin-left: 8px; vertical-align: middle; font-style: italic;\">Est. Stats: <span>${ff_response.bs_estimate_human}</span></span>`;
    }
 
    return `<span style=\"font-weight: bold; margin-right: 6px;\">FairFight:</span><span style=\"background: ${background_colour}; color: ${text_colour}; font-weight: bold; padding: 2px 6px; border-radius: 4px; display: inline-block;\">${ff_string} (${difficulty}) ${fresh}</span>${statDetails}`;
  }
 
  function get_ff_string_short(ff_response, player_id) {
    const ff = ff_response.value.toFixed(2);
 
    const now = Date.now() / 1000;
    const age = now - ff_response.last_updated;
 
    if (ff > 99) {
      return `high`;
    }
 
    var suffix = "";
    if (age > 14 * 24 * 60 * 60) {
      suffix = "?";
    }
 
    return `${ff}${suffix}`;
  }
 
  function set_fair_fight(ff_response, player_id) {
    const detailed_message = get_detailed_message(ff_response, player_id);
    info_line.innerHTML = detailed_message;
  }
 
  function get_members() {
    var player_ids = [];
    $(".table-body > .table-row").each(function () {
      if (!$(this).find(".fallen").length) {
        if (!$(this).find(".fedded").length) {
          $(this)
            .find(".member")
            .each(function (index, value) {
              var url = value.querySelectorAll('a[href^="/profiles"]')[0].href;
              var player_id = url.match(/.*XID=(?<player_id>\d+)/).groups
                .player_id;
              player_ids.push(parseInt(player_id));
            });
        }
      }
    });
 
    return player_ids;
  }
 
  function rgbToHex(r, g, b) {
    return (
      "#" +
      ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()
    ); // Convert to hex and return
  }
 
  function get_ff_colour(value) {
    let r, g, b;
 
    // Transition from
    // blue - #2828c6
    // to
    // green - #28c628
    // to
    // red - #c62828
    if (value <= 1) {
      // Blue
      r = 0x28;
      g = 0x28;
      b = 0xc6;
    } else if (value <= 3) {
      // Transition from blue to green
      const t = (value - 1) / 2; // Normalize to range [0, 1]
      r = 0x28;
      g = Math.round(0x28 + (0xc6 - 0x28) * t);
      b = Math.round(0xc6 - (0xc6 - 0x28) * t);
    } else if (value <= 5) {
      // Transition from green to red
      const t = (value - 3) / 2; // Normalize to range [0, 1]
      r = Math.round(0x28 + (0xc6 - 0x28) * t);
      g = Math.round(0xc6 - (0xc6 - 0x28) * t);
      b = 0x28;
    } else {
      // Red
      r = 0xc6;
      g = 0x28;
      b = 0x28;
    }
 
    return rgbToHex(r, g, b); // Return hex value
  }
 
  function get_contrast_color(hex) {
    // Convert hex to RGB
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
 
    // Calculate brightness
    const brightness = r * 0.299 + g * 0.587 + b * 0.114;
    return brightness > 126 ? "black" : "white"; // Return black or white based on brightness
  }
 
  async function get_cached_value(player_id) {
    const r = await ffcache.get([parseInt(player_id)]);
    if (r[player_id]) {
      return r[player_id];
    }
    return null;
  }
 
  async function apply_fair_fight_info(_) {
    var ff_li = document.createElement("li");
    ff_li.tabIndex = "0";
    ff_li.classList.add("table-cell");
    ff_li.classList.add("lvl");
    ff_li.classList.add("torn-divider");
    ff_li.classList.add("divider-vertical");
    ff_li.classList.add("c-pointer");
    ff_li.classList.add("ff-scouter-ff-visible");
    ff_li.onclick = () => {
      $(".ff-scouter-ff-visible").each(function (_, value) {
        value.classList.remove("ff-scouter-ff-visible");
        value.classList.add("ff-scouter-ff-hidden");
      });
      $(".ff-scouter-est-hidden").each(function (_, value) {
        value.classList.remove("ff-scouter-est-hidden");
        value.classList.add("ff-scouter-est-visible");
      });
    };
    ff_li.appendChild(document.createTextNode("FF"));
    var est_li = document.createElement("li");
    est_li.tabIndex = "0";
    est_li.classList.add("table-cell");
    est_li.classList.add("lvl");
    est_li.classList.add("torn-divider");
    est_li.classList.add("divider-vertical");
    est_li.classList.add("c-pointer");
    est_li.classList.add("ff-scouter-est-hidden");
    est_li.onclick = () => {
      $(".ff-scouter-ff-hidden").each(function (_, value) {
        value.classList.remove("ff-scouter-ff-hidden");
        value.classList.add("ff-scouter-ff-visible");
      });
      $(".ff-scouter-est-visible").each(function (_, value) {
        value.classList.remove("ff-scouter-est-visible");
        value.classList.add("ff-scouter-est-hidden");
      });
    };
    est_li.appendChild(document.createTextNode("Est"));
 
    if ($(".table-header > .lvl").length == 0) {
      // The .member-list doesn't have a .lvl, give up
      return;
    }
    $(".table-header > .lvl")[0].after(ff_li, est_li);
 
    const player_ids = [];
    $(".table-body > .table-row > .member").each(async function (_, value) {
      var url = value.querySelectorAll('a[href^="/profiles"]')[0].href;
      var player_id = url.match(/.*XID=(?<player_id>\d+)/).groups.player_id;
      player_ids.push(parseInt(player_id));
    });
 
    const cached_values = await ffcache.get(player_ids);
 
    $(".table-body > .table-row > .member").each(async function (_, value) {
      var url = value.querySelectorAll('a[href^="/profiles"]')[0].href;
      var player_id = parseInt(
        url.match(/.*XID=(?<player_id>\d+)/).groups.player_id,
      );
 
      var fair_fight_div = document.createElement("div");
      fair_fight_div.classList.add("table-cell");
      fair_fight_div.classList.add("lvl");
      fair_fight_div.classList.add("ff-scouter-ff-visible");
 
      var estimate_div = document.createElement("div");
      estimate_div.classList.add("table-cell");
      estimate_div.classList.add("lvl");
      estimate_div.classList.add("ff-scouter-est-hidden");
 
      const cached = cached_values[player_id];
      if (cached && cached.value) {
        const ff = cached.value;
        const ff_string = get_ff_string_short(cached, player_id);
 
        const background_colour = get_ff_colour(ff);
        const text_colour = get_contrast_color(background_colour);
        fair_fight_div.style.backgroundColor = background_colour;
        fair_fight_div.style.color = text_colour;
        fair_fight_div.style.fontWeight = "bold";
        fair_fight_div.innerHTML = ff_string;
 
        if (cached.bs_estimate_human) {
          estimate_div.innerHTML = cached.bs_estimate_human;
        }
      }
 
      value.nextSibling.after(fair_fight_div, estimate_div);
    });
  }
 
  async function get_cache_misses(player_ids) {
    var unknown_player_ids = [];
    const cached_players = await ffcache.get(player_ids);
    for (const player_id of player_ids) {
      if (player_id in cached_players === false) {
        unknown_player_ids.push(player_id);
      }
    }
    return unknown_player_ids;
  }
 
  create_text_location();
 
  const match1 = window.location.href.match(
    /https:\/\/www.torn.com\/profiles.php\?XID=(?<target_id>\d+)/,
  );
  const match2 = window.location.href.match(
    /https:\/\/www.torn.com\/loader.php\?sid=attack&user2ID=(?<target_id>\d+)/,
  );
  const match = match1 ?? match2;
  if (match) {
    // We're on a profile page or an attack page - get the fair fight score
    var target_id = parseInt(match.groups.target_id);
    update_ff_cache([target_id], function (target_ids) {
      display_fair_fight(target_ids[0], target_id);
    });
 
    if (!key) {
      set_message("[FF Scouter V2]: Limited API key needed - click to add");
    }
  } else if (
    window.location.href.startsWith("https://www.torn.com/factions.php")
  ) {
    const torn_observer = new MutationObserver(async function () {
      // Find the member table - add a column if it doesn't already have one, for FF scores
      var members_list = $(".members-list")[0];
      if (members_list) {
        torn_observer.disconnect();
 
        var player_ids = get_members();
        await update_ff_cache(player_ids, apply_fair_fight_info);
      }
    });
 
    torn_observer.observe(document, {
      attributes: false,
      childList: true,
      characterData: false,
      subtree: true,
    });
 
    if (!key) {
      set_message("[FF Scouter V2]: Limited API key needed - click to add");
    }
  } else {
    // console.log("Did not match against " + window.location.href);
  }
 
  function get_player_id_in_element(element) {
    const match = element.parentElement?.href?.match(/.*XID=(?<target_id>\d+)/);
    if (match) {
      return parseInt(match.groups.target_id);
    }
 
    const anchors = element.getElementsByTagName("a");
 
    for (const anchor of anchors) {
      const match = anchor.href.match(/.*XID=(?<target_id>\d+)/);
      if (match) {
        return parseInt(match.groups.target_id);
      }
      const matchUserId = anchor.href.match(/.*userId=(?<target_id>\d+)/);
      if (matchUserId) {
        return parseInt(matchUserId.groups.target_id);
      }
    }
 
    if (element.nodeName.toLowerCase() === "a") {
      const match = element.href.match(/.*XID=(?<target_id>\d+)/);
      if (match) {
        return parseInt(match.groups.target_id);
      }
      const matchUserId = element.href.match(/.*userId=(?<target_id>\d+)/);
      if (matchUserId) {
        return parseInt(matchUserId.groups.target_id);
      }
    }
 
    return null;
  }
 
  function ff_to_percent(ff) {
    // The percent is 0-33% 33-66% 66%-100%
    // With configurable ranges there are no guarantees that the sections are linear
    const stored_values = get_ff_ranges();
    const low_ff = stored_values.low;
    const high_ff = stored_values.high;
    const low_mid_percent = 33;
    const mid_high_percent = 66;
    ff = Math.min(ff, stored_values.max);
    var percent;
    if (ff < low_ff) {
      percent = ((ff - 1) / (low_ff - 1)) * low_mid_percent;
    } else if (ff < high_ff) {
      percent =
        ((ff - low_ff) / (high_ff - low_ff)) *
          (mid_high_percent - low_mid_percent) +
        low_mid_percent;
    } else {
      percent =
        ((ff - high_ff) / (stored_values.max - high_ff)) *
          (100 - mid_high_percent) +
        mid_high_percent;
    }
 
    return percent;
  }
 
  async function show_cached_values(elements) {
    // Rescan player ids because the competition page can rewrite them
    elements = elements.map((e) => {
      const player_id = get_player_id_in_element(e[1]);
      if (e[0] != player_id) {
        ffdebug(
          "[FF Scouter V2] Torn rewrote player element between request and response! Previous player_id:",
          e[0],
          "; New player_id:",
          player_id,
          "; Element:",
          e[1],
        );
      }
      return [player_id, e[1]];
    });
    // Remove any elements that don't have an id
    elements = elements.filter((e) => e[0]);
    const cached_values = await ffcache.get(
      elements.map((e) => parseInt(e[0])),
    );
    for (const [player_id, element] of elements) {
      element.classList.add("ff-scouter-indicator");
      if (!element.classList.contains("indicator-lines")) {
        element.classList.add("indicator-lines");
        element.style.setProperty("--arrow-width", "20px");
 
        // Ugly - does removing this break anything?
        element.classList.remove("small");
        element.classList.remove("big");
 
        //$(element).append($("<div>", { class: "ff-scouter-vertical-line-low-upper" }));
        //$(element).append($("<div>", { class: "ff-scouter-vertical-line-low-lower" }));
        //$(element).append($("<div>", { class: "ff-scouter-vertical-line-high-upper" }));
        //$(element).append($("<div>", { class: "ff-scouter-vertical-line-high-lower" }));
      }
 
      const cached = cached_values[parseInt(player_id)];
      if (cached && cached.value) {
        const percent = ff_to_percent(cached.value);
        element.style.setProperty("--band-percent", percent);
 
        $(element).find(".ff-scouter-arrow").remove();
 
        var arrow;
        if (percent < 33) {
          arrow = BLUE_ARROW;
        } else if (percent < 66) {
          arrow = GREEN_ARROW;
        } else {
          arrow = RED_ARROW;
        }
        const img = $("<img>", {
          src: arrow,
          class: "ff-scouter-arrow",
        });
        $(element).append(img);
      }
    }
  }
 
  async function apply_ff_gauge(elements) {
    // Remove elements which already have the class
    elements = elements.filter(
      (e) => !e.classList.contains("ff-scouter-indicator"),
    );
    // Convert elements to a list of tuples
    elements = elements.map((e) => {
      const player_id = get_player_id_in_element(e);
      return [player_id, e];
    });
    // Remove any elements that don't have an id
    elements = elements.filter((e) => e[0]);
 
    if (elements.length > 0) {
      // Display cached values immediately
      // This is also important to ensure we only iterate the list once
      // Then update
      // Then re-display after the update
      show_cached_values(elements);
      const player_ids = elements.map((e) => e[0]);
      await update_ff_cache(player_ids, () => {
        show_cached_values(elements);
      });
    }
  }
 
  async function apply_to_mini_profile(mini) {
    // Get the user id, and the details
    // Then in profile-container.description append a new span with the text. Win
    const player_id = get_player_id_in_element(mini);
    if (player_id) {
      const response = await get_cached_value(player_id);
      if (response && response.value) {
        // Remove any existing elements
        $(mini).find(".ff-scouter-mini-ff").remove();
 
        // Minimal, text-only Fair Fight string for mini-profiles
        const ff_string = get_ff_string(response);
        const difficulty = get_difficulty_text(response.value);
        const now = Date.now() / 1000;
        const age = now - response.last_updated;
        let fresh = "";
        if (age < 24 * 60 * 60) {
          // Pass
        } else if (age < 31 * 24 * 60 * 60) {
          var days = Math.round(age / (24 * 60 * 60));
          fresh = days === 1 ? "(1 day old)" : `(${days} days old)`;
        } else if (age < 365 * 24 * 60 * 60) {
          var months = Math.round(age / (31 * 24 * 60 * 60));
          fresh = months === 1 ? "(1 month old)" : `(${months} months old)`;
        } else {
          var years = Math.round(age / (365 * 24 * 60 * 60));
          fresh = years === 1 ? "(1 year old)" : `(${years} years old)`;
        }
        const message = `FF ${ff_string} (${difficulty}) ${fresh}`;
 
        const description = $(mini).find(".description");
        const desc = $("<span></span>", {
          class: "ff-scouter-mini-ff",
        });
        desc.text(message);
        $(description).append(desc);
      }
    }
  }
 
  const ff_gauge_observer = new MutationObserver(async function () {
    var honor_bars = $(".honor-text-wrap").toArray();
    var name_elems = $(".user.name");
    if (honor_bars.length > 0) {
      await apply_ff_gauge($(".honor-text-wrap").toArray());
    } else {
      if (
        window.location.href.startsWith("https://www.torn.com/factions.php")
      ) {
        await apply_ff_gauge($(".member").toArray());
      } else if (
        window.location.href.startsWith("https://www.torn.com/companies.php")
      ) {
        await apply_ff_gauge($(".employee").toArray());
      } else if (
        window.location.href.startsWith(
          "https://www.torn.com/page.php?sid=competition#/team",
        )
      ) {
        await apply_ff_gauge($(".name___H_bss").toArray());
      } else if (
        window.location.href.startsWith("https://www.torn.com/joblist.php")
      ) {
        await apply_ff_gauge($(".employee").toArray());
      } else if (
        window.location.href.startsWith("https://www.torn.com/messages.php")
      ) {
        await apply_ff_gauge($(".name").toArray());
      } else if (
        window.location.href.startsWith("https://www.torn.com/index.php")
      ) {
        await apply_ff_gauge($(".name").toArray());
      } else if (
        window.location.href.startsWith("https://www.torn.com/hospitalview.php")
      ) {
        await apply_ff_gauge($(".name").toArray());
      } else if (
        window.location.href.startsWith(
          "https://www.torn.com/page.php?sid=UserList",
        )
      ) {
        await apply_ff_gauge($(".name").toArray());
      } else if (
        window.location.href.startsWith("https://www.torn.com/bounties.php")
      ) {
        await apply_ff_gauge($(".target").toArray());
        await apply_ff_gauge($(".listed").toArray());
      } else if (
        window.location.href.startsWith(
          "https://www.torn.com/loader.php?sid=attackLog",
        )
      ) {
        const participants = $("ul.participants-list li").toArray();
        if (participants > 100) {
          return;
        }
        await apply_ff_gauge(participants);
      } else if (
        window.location.href.startsWith("https://www.torn.com/forums.php")
      ) {
        await apply_ff_gauge($(".last-poster").toArray());
        await apply_ff_gauge($(".starter").toArray());
        await apply_ff_gauge($(".last-post").toArray());
        await apply_ff_gauge($(".poster").toArray());
      } else if (window.location.href.includes("page.php?sid=hof")) {
        await apply_ff_gauge($('[class^="userInfoBox__"]').toArray());
      } else if (name_elems.length > 0) {
        // Fallback for anyone without honor bars enabled
        await apply_ff_gauge($(".user.name").toArray());
      }
    }
    if (
      window.location.href.startsWith(
        "https://www.torn.com/page.php?sid=ItemMarket",
      )
    ) {
      await apply_ff_gauge(
        $(
          "div.bazaar-listing-card div:first-child div:first-child > a",
        ).toArray(),
      );
    }
 
    var mini_profiles = $(
      '[class^="profile-mini-_userProfileWrapper_"]',
    ).toArray();
    if (mini_profiles.length > 0) {
      for (const mini of mini_profiles) {
        if (!mini.classList.contains("ff-processed")) {
          mini.classList.add("ff-processed");
 
          const player_id = get_player_id_in_element(mini);
          apply_to_mini_profile(mini);
          await update_ff_cache([player_id], () => {
            apply_to_mini_profile(mini);
          });
        }
      }
    }
  });
 
  ff_gauge_observer.observe(document, {
    attributes: false,
    childList: true,
    characterData: false,
    subtree: true,
  });
 
  function get_cached_targets(staleok) {
    const value = rD_getValue(TARGET_KEY);
    if (!value) {
      return null;
    }
 
    let parsed = null;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
 
    if (parsed == null) {
      return null;
    }
 
    if (staleok) {
      return parsed.targets;
    }
 
    if (parsed.last_updated + FF_TARGET_STALENESS > new Date()) {
      // Old cache, return nothing
      return null;
    }
 
    return parsed.targets;
  }
 
  function get_next_target_index() {
    const value = Number(rD_getValue(TARGET_INDEX_KEY, 0));
 
    rD_setValue(TARGET_INDEX_KEY, value + 1);
 
    return value;
  }
 
  function reset_next_target_index() {
    rD_setValue(TARGET_INDEX_KEY, 0);
  }
 
  function update_ff_targets() {
    if (!key) {
      return;
    }
 
    const cached = get_cached_targets(false);
    if (cached) {
      return;
    }
 
    const chain_ff_target = ffSettingsGet("chain-ff-target") || "2.5";
 
    const url = `${BASE_URL}/api/v1/get-targets?key=${key}&inactiveonly=1&maxff=${chain_ff_target}&limit=50`;
 
    console.log("[FF Scouter V2] Refreshing chain list");
    rD_xmlhttpRequest({
      method: "GET",
      url: url,
      onload: function (response) {
        if (!response) {
          return;
        }
        if (response.status == 200) {
          var ff_response = JSON.parse(response.responseText);
          if (ff_response && ff_response.error) {
            showToast(ff_response.error);
            return;
          }
          if (ff_response.targets) {
            const result = {
              targets: ff_response.targets,
              last_updated: new Date(),
            };
            rD_setValue(TARGET_KEY, JSON.stringify(result));
            console.log("[FF Scouter V2] Chain list updated successfully");
          }
        } else {
          try {
            var err = JSON.parse(response.responseText);
            if (err && err.error) {
              showToast(
                "API request failed. Error: " +
                  err.error +
                  "; Code: " +
                  err.code,
              );
            } else {
              showToast(
                "API request failed. HTTP status code: " + response.status,
              );
            }
          } catch {
            showToast(
              "API request failed. HTTP status code: " + response.status,
            );
          }
        }
      },
      onerror: function (e) {
        console.error("[FF Scouter V2] **** error ", e, "; Stack:", e.stack);
      },
      onabort: function (e) {
        console.error("[FF Scouter V2] **** abort ", e, "; Stack:", e.stack);
      },
      ontimeout: function (e) {
        console.error("[FF Scouter V2] **** timeout ", e, "; Stack:", e.stack);
      },
    });
  }
 
  function get_random_chain_target() {
    const targets = get_cached_targets(true);
    if (!targets) {
      return null;
    }
 
    let index = get_next_target_index();
 
    if (index >= targets.length) {
      index = 0;
      reset_next_target_index();
    }
 
    return targets[index];
  }
 
  function clear_cached_targets() {
    rD_deleteValue(TARGET_KEY);
  }
 
  // Chain button stolen from https://greasyfork.org/en/scripts/511916-random-target-finder
  function create_chain_button() {
    // Check if chain button is enabled in settings
    if (!ffSettingsGetToggle("chain-button-enabled")) {
      ffdebug("[FF Scouter V2] Chain button disabled in settings");
      return;
    }
 
    const button = document.createElement("button");
    button.innerHTML = "FF";
    button.style.position = "fixed";
    //button.style.top = '10px';
    //button.style.right = '10px';
    button.style.top = "32%"; // Adjusted to center vertically
    button.style.right = "0%"; // Center horizontally
    //button.style.transform = 'translate(-50%, -50%)'; // Center the button properly
    button.style.zIndex = "9999";
 
    // Add CSS styles for a green background
    button.style.backgroundColor = "green";
    button.style.color = "white";
    button.style.border = "none";
    button.style.padding = "6px";
    button.style.borderRadius = "6px";
    button.style.cursor = "pointer";
 
    // Add a click event listener to open Google in a new tab
    button.addEventListener("click", function () {
      let rando = get_random_chain_target();
      if (!rando) {
        return;
      }
 
      const linkType = ffSettingsGet("chain-link-type") || "attack";
      const tabType = ffSettingsGet("chain-tab-type") || "newtab";
 
      let profileLink;
      if (linkType === "profile") {
        profileLink = `https://www.torn.com/profiles.php?XID=${rando.player_id}`;
      } else {
        profileLink = `https://www.torn.com/loader.php?sid=attack&user2ID=${rando.player_id}`;
      }
 
      if (tabType === "sametab") {
        window.location.href = profileLink;
      } else {
        window.open(profileLink, "_blank");
      }
    });
    // Add the button to the page
    document.body.appendChild(button);
  }
 
  function abbreviateCountry(name) {
    if (!name) return "";
    if (name.trim().toLowerCase() === "switzerland") return "Switz";
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0];
    return words.map((w) => w[0].toUpperCase()).join("");
  }
 
  function formatTime(ms) {
    let totalSeconds = Math.max(0, Math.floor(ms / 1000));
    let hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    let minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(
      2,
      "0",
    );
    let seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  }
 
  function fetchFactionData(factionID) {
    const url = `https://api.torn.com/v2/faction/${factionID}/members?striptags=true&key=${key}`;
    return fetch(url).then((response) => response.json());
  }
 
  function updateMemberStatus(li, member) {
    if (!member || !member.status) return;
 
    let statusEl = li.querySelector(".status");
    if (!statusEl) return;
 
    let lastActionRow = li.querySelector(".last-action-row");
    let lastActionText = member.last_action?.relative || "";
    if (lastActionRow) {
      lastActionRow.textContent = `Last Action: ${lastActionText}`;
    } else {
      lastActionRow = document.createElement("div");
      lastActionRow.className = "last-action-row";
      lastActionRow.textContent = `Last Action: ${lastActionText}`;
      let lastDiv = Array.from(li.children)
        .reverse()
        .find((el) => el.tagName === "DIV");
      if (lastDiv?.nextSibling) {
        li.insertBefore(lastActionRow, lastDiv.nextSibling);
      } else {
        li.appendChild(lastActionRow);
      }
    }
 
    // Handle status changes
    if (member.status.state === "Okay") {
      if (statusEl.dataset.originalHtml) {
        statusEl.innerHTML = statusEl.dataset.originalHtml;
        delete statusEl.dataset.originalHtml;
      }
      statusEl.textContent = "Okay";
    } else if (member.status.state === "Traveling") {
      if (!statusEl.dataset.originalHtml) {
        statusEl.dataset.originalHtml = statusEl.innerHTML;
      }
 
      let description = member.status.description || "";
      let location = "";
      let isReturning = false;
 
      if (description.includes("Returning to Torn from ")) {
        location = description.replace("Returning to Torn from ", "");
        isReturning = true;
      } else if (description.includes("Traveling to ")) {
        location = description.replace("Traveling to ", "");
      }
 
      let abbr = abbreviateCountry(location);
      const planeSvg = `<svg class="plane-svg ${isReturning ? "returning" : ""}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512">
                    <path d="M482.3 192c34.2 0 93.7 29 93.7 64c0 36-59.5 64-93.7 64l-116.6 0L265.2 495.9c-5.7 10-16.3 16.1-27.8 16.1l-56.2 0c-10.6 0-18.3-10.2-15.4-20.4l49-171.6L112 320 68.8 377.6c-3 4-7.8 6.4-12.8 6.4l-42 0c-7.8 0-14-6.3-14-14c0-1.3 .2-2.6 .5-3.9L32 256 .5 145.9c-.4-1.3-.5-2.6-.5-3.9c0-7.8 6.3-14 14-14l42 0c5 0 9.8 2.4 12.8 6.4L112 192l102.9 0-49-171.6C162.9 10.2 170.6 0 181.2 0l56.2 0c11.5 0 22.1 6.2 27.8 16.1L365.7 192l116.6 0z"/>
                </svg>`;
      const tornSymbol = `<svg class="torn-symbol" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/>
                    <text x="12" y="16" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="14" fill="currentColor">T</text>
                </svg>`;
      statusEl.innerHTML = `<span class="travel-status">${tornSymbol}${planeSvg}<span class="country-abbr">${abbr}</span></span>`;
    } else if (member.status.state === "Abroad") {
      if (!statusEl.dataset.originalHtml) {
        statusEl.dataset.originalHtml = statusEl.innerHTML;
      }
      let description = member.status.description || "";
      if (description.startsWith("In ")) {
        let location = description.replace("In ", "");
        let abbr = abbreviateCountry(location);
        statusEl.textContent = `in ${abbr}`;
      }
    }
 
    // Update countdown
    if (member.status.until && parseInt(member.status.until, 10) > 0) {
      memberCountdowns[member.id] = parseInt(member.status.until, 10);
    } else {
      delete memberCountdowns[member.id];
    }
  }
 
  function updateFactionStatuses(factionID, container) {
    apiCallInProgressCount++;
    fetchFactionData(factionID)
      .then((data) => {
        if (!Array.isArray(data.members)) {
          console.warn(
            `[FF Scouter V2] No members array for faction ${factionID}`,
          );
          return;
        }
 
        const memberMap = {};
        data.members.forEach((member) => {
          memberMap[member.id] = member;
        });
 
        container.querySelectorAll("li").forEach((li) => {
          let profileLink = li.querySelector('a[href*="profiles.php?XID="]');
          if (!profileLink) return;
          let match = profileLink.href.match(/XID=(\d+)/);
          if (!match) return;
          let userID = match[1];
          updateMemberStatus(li, memberMap[userID]);
        });
      })
      .catch((err) => {
        console.error(
          "[FF Scouter V2] Error fetching faction data for faction",
          factionID,
          err,
        );
      })
      .finally(() => {
        apiCallInProgressCount--;
      });
  }
 
  function updateAllMemberTimers() {
    const liElements = document.querySelectorAll(
      ".enemy-faction .members-list li, .your-faction .members-list li",
    );
    liElements.forEach((li) => {
      let profileLink = li.querySelector('a[href*="profiles.php?XID="]');
      if (!profileLink) return;
      let match = profileLink.href.match(/XID=(\d+)/);
      if (!match) return;
      let userID = match[1];
      let statusEl = li.querySelector(".status");
      if (!statusEl) return;
      if (memberCountdowns[userID]) {
        let remaining = memberCountdowns[userID] * 1000 - Date.now();
        if (remaining < 0) remaining = 0;
        statusEl.textContent = formatTime(remaining);
      }
    });
  }
 
  function updateAPICalls() {
    let enemyFactionLink = document.querySelector(
      ".opponentFactionName___vhESM",
    );
    let yourFactionLink = document.querySelector(".currentFactionName___eq7n8");
    if (!enemyFactionLink || !yourFactionLink) return;
 
    let enemyFactionIdMatch = enemyFactionLink.href.match(/ID=(\d+)/);
    let yourFactionIdMatch = yourFactionLink.href.match(/ID=(\d+)/);
    if (!enemyFactionIdMatch || !yourFactionIdMatch) return;
 
    let enemyList = document.querySelector(".enemy-faction .members-list");
    let yourList = document.querySelector(".your-faction .members-list");
    if (!enemyList || !yourList) return;
 
    updateFactionStatuses(enemyFactionIdMatch[1], enemyList);
    updateFactionStatuses(yourFactionIdMatch[1], yourList);
  }
 
  function initWarScript() {
    let enemyFactionLink = document.querySelector(
      ".opponentFactionName___vhESM",
    );
    let yourFactionLink = document.querySelector(".currentFactionName___eq7n8");
    if (!enemyFactionLink || !yourFactionLink) return false;
 
    let enemyList = document.querySelector(".enemy-faction .members-list");
    let yourList = document.querySelector(".your-faction .members-list");
    if (!enemyList || !yourList) return false;
 
    updateAPICalls();
    setInterval(updateAPICalls, API_INTERVAL);
    console.log(
      "[FF Scouter V2] Torn Faction Status Countdown (Real-Time & API Status - Relative Last): Initialized",
    );
    return true;
  }
 
  let warObserver = new MutationObserver((mutations, obs) => {
    if (initWarScript()) {
      obs.disconnect();
    }
  });
 
  // Only initialize war monitoring if enabled in settings
  if (
    !document.getElementById("FFScouterV2DisableWarMonitor") &&
    ffSettingsGetToggle("war-monitor-enabled")
  ) {
    warObserver.observe(document.body, { childList: true, subtree: true });
 
    const memberTimersInterval = setInterval(updateAllMemberTimers, 1000);
 
    window.addEventListener("FFScouterV2DisableWarMonitor", () => {
      console.log(
        "[FF Scouter V2] Caught disable event, removing monitoring observer and interval",
      );
      warObserver.disconnect();
 
      clearInterval(memberTimersInterval);
    });
  }
  // Try to be friendly and detect other war monitoring scripts
  const catchOtherScripts = () => {
    if (
      Array.from(document.querySelectorAll("style")).some(
        (style) =>
          style.textContent.includes(
            '.members-list li:has(div.status[data-twse-highlight="true"])', // Torn War Stuff Enhanced
          ) ||
          style.textContent.includes(".warstuff_highlight") || // Torn War Stuff
          style.textContent.includes(".finally-bs-stat"), // wall-battlestats
      )
    ) {
      window.dispatchEvent(new Event("FFScouterV2DisableWarMonitor"));
    }
  };
  catchOtherScripts();
  setTimeout(catchOtherScripts, 500);
 
  function waitForElement(querySelector, timeout = 15000) {
    return new Promise((resolve) => {
      // Check if element already exists
      const existingElement = document.querySelector(querySelector);
      if (existingElement) {
        return resolve(existingElement);
      }
 
      // Set up observer to watch for element
      const observer = new MutationObserver(() => {
        const element = document.querySelector(querySelector);
        if (element) {
          observer.disconnect();
          if (timer) {
            clearTimeout(timer);
          }
          resolve(element);
        }
      });
 
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
 
      // Set up timeout
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }
 
  async function getLocalUserId() {
    const profileLink = await waitForElement(
      ".settings-menu > .link > a:first-child",
      15000,
    );
 
    if (!profileLink) {
      console.error(
        "[FF Scouter V2] Could not find profile link in settings menu",
      );
      return null;
    }
 
    const match = profileLink.href.match(/XID=(\d+)/);
    if (match) {
      const userId = match[1];
      ffdebug(`[FF Scouter V2] Found local user ID: ${userId}`);
      return userId;
    }
 
    console.error(
      "[FF Scouter V2] Could not extract user ID from profile link",
    );
    return null;
  }
 
  function getCurrentUserId() {
    return currentUserId;
  }
 
  // Settings management utilities
  function ffSettingsGet(key) {
    return rD_getValue(`ffscouterv2-${key}`, null);
  }
 
  function ffSettingsSet(key, value) {
    rD_setValue(`ffscouterv2-${key}`, value);
  }
 
  function ffSettingsGetToggle(key) {
    return ffSettingsGet(key) === "true";
  }
 
  function ffSettingsSetToggle(key, value) {
    ffSettingsSet(key, value.toString());
  }
 
  async function createSettingsPanel() {
    // Check if we're on the user's own profile page
    const pageId = window.location.href.match(/XID=(\d+)/)?.[1];
    if (!pageId || pageId !== currentUserId) {
      return;
    }
 
    // Wait for profile wrapper to be available
    const profileWrapper = await waitForElement(".profile-wrapper", 15000);
    if (!profileWrapper) {
      console.error(
        "[FF Scouter V2] Could not find profile wrapper for settings panel",
      );
      return;
    }
 
    // Check if settings panel already exists
    if (document.querySelector(".ff-settings-accordion")) {
      ffdebug("[FF Scouter V2] Settings panel already exists");
      return;
    }
 
    // Get current user data for display
    const userName =
      profileWrapper.querySelector(".user-name")?.textContent ||
      profileWrapper.querySelector(".profile-name")?.textContent ||
      profileWrapper.querySelector("h1")?.textContent ||
      "User";
 
    // Create the settings panel
    const settingsPanel = document.createElement("details");
    settingsPanel.className = "ff-settings-accordion";
 
    profileWrapper.parentNode.insertBefore(
      settingsPanel,
      profileWrapper.nextSibling,
    );
 
    // Add glow effect if API key is not set
    if (!key) {
      settingsPanel.classList.add("ff-settings-glow");
    }
 
    // Create summary
    const summary = document.createElement("summary");
    summary.textContent = "FF Scouter Settings";
    settingsPanel.appendChild(summary);
 
    // Create main content div
    const content = document.createElement("div");
    content.className = "ff-settings-body";
 
    // API Key Explanation
    const apiExplanation = document.createElement("div");
    apiExplanation.className = "ff-api-explanation ff-api-explanation-content";
 
    apiExplanation.innerHTML = `
      <strong>Important:</strong> You must use the SAME exact API key that you use on 
      <a href="https://ffscouter.com/" target="_blank">ffscouter.com</a>.
      <br><br>
      If you're not sure which API key you used, go to 
      <a href="https://www.torn.com/preferences.php#tab=api" target="_blank">your API preferences</a> 
      and look for "FFScouter3" in your API key history comments.
    `;
    content.appendChild(apiExplanation);
 
    // API Key Input
 
    if (apikey[0] == "#") {
      const apiKeyDiv = document.createElement("div");
      apiKeyDiv.className = "ff-settings-entry ff-settings-entry-large";
 
      const apiKeyLabel = document.createElement("label");
      apiKeyLabel.setAttribute("for", "ff-api-key");
      apiKeyLabel.textContent = "FF Scouter API Key:";
      apiKeyLabel.className = "ff-settings-label ff-settings-label-inline";
      apiKeyDiv.appendChild(apiKeyLabel);
 
      const apiKeyInput = document.createElement("input");
      apiKeyInput.type = "text";
      apiKeyInput.id = "ff-api-key";
      apiKeyInput.placeholder = "Paste your key here...";
      apiKeyInput.className = "ff-settings-input ff-settings-input-wide";
      apiKeyInput.value = key || "";
 
      // Add blur class if key exists
      if (key) {
        apiKeyInput.classList.add("ff-blur");
      }
 
      apiKeyInput.addEventListener("focus", function () {
        this.classList.remove("ff-blur");
      });
 
      apiKeyInput.addEventListener("blur", function () {
        if (this.value) {
          this.classList.add("ff-blur");
        }
      });
 
      apiKeyInput.addEventListener("change", function () {
        const newKey = this.value;
 
        if (typeof newKey !== "string") {
          return;
        }
 
        if (newKey && newKey.length < 10) {
          this.style.outline = "1px solid red";
          return;
        }
 
        this.style.outline = "none";
 
        if (newKey === key) return;
 
        rD_setValue("limited_key", newKey);
        key = newKey;
 
        if (newKey) {
          this.classList.add("ff-blur");
          settingsPanel.classList.remove("ff-settings-glow");
        } else {
          settingsPanel.classList.add("ff-settings-glow");
        }
      });
 
      apiKeyDiv.appendChild(apiKeyInput);
      content.appendChild(apiKeyDiv);
    } else {
      const apiKeyDiv = document.createElement("div");
      apiKeyDiv.className = "ff-settings-entry ff-settings-entry-large";
 
      const apiKeyLabel = document.createElement("label");
      apiKeyLabel.setAttribute("for", "ff-api-key");
      apiKeyLabel.textContent = "FF Scouter API Key:";
      apiKeyLabel.className = "ff-settings-label ff-settings-label-inline";
      apiKeyDiv.appendChild(apiKeyLabel);
 
      const apiKeyInput = document.createElement("label");
      apiKeyInput.textContent = "Code entered in Torn PDA User Scripts";
      apiKeyInput.className = "ff-settings-label ff-settings-label-inline";
      apiKeyDiv.appendChild(apiKeyInput);
 
      content.appendChild(apiKeyDiv);
    }
 
    const rangesDiv = document.createElement("div");
    rangesDiv.className = "ff-settings-entry ff-settings-entry-large";
 
    const rangesLabel = document.createElement("label");
    rangesLabel.setAttribute("for", "ff-ranges");
    rangesLabel.textContent =
      "FF Ranges (Low, High, Max) -- affects the color and positions of the arrows over player's honor bars:";
    rangesLabel.className = "ff-settings-label ff-settings-label-inline";
    rangesDiv.appendChild(rangesLabel);
 
    const rangesInput = document.createElement("input");
    rangesInput.type = "text";
    rangesInput.id = "ff-ranges";
    rangesInput.placeholder = "2,4,8";
    rangesInput.className = "ff-settings-input ff-settings-input-narrow";
 
    // Set current values
    const currentRanges = get_ff_ranges(true);
    if (currentRanges) {
      rangesInput.value = `${currentRanges.low},${currentRanges.high},${currentRanges.max}`;
    }
 
    rangesInput.addEventListener("change", function () {
      const value = this.value;
 
      if (value === "") {
        reset_ff_ranges();
        this.style.outline = "none";
        return;
      }
 
      const parts = value.split(",").map((p) => p.trim());
      if (parts.length !== 3) {
        this.style.outline = "1px solid red";
        showToast(
          "Incorrect format: FF ranges should be exactly 3 numbers separated by commas [low,high,max]",
        );
        return;
      }
 
      try {
        const low = parseFloat(parts[0]);
        const high = parseFloat(parts[1]);
        const max = parseFloat(parts[2]);
 
        if (isNaN(low) || isNaN(high) || isNaN(max)) {
          throw new Error("Invalid numbers");
        }
 
        if (low <= 0 || high <= 0 || max <= 0) {
          this.style.outline = "1px solid red";
          showToast("FF ranges must be positive numbers");
          return;
        }
 
        if (low >= high || high >= max) {
          this.style.outline = "1px solid red";
          showToast("FF ranges must be in ascending order: low < high < max");
          return;
        }
 
        set_ff_ranges(low, high, max);
        this.style.outline = "none";
        showToast("FF ranges updated successfully!");
      } catch (e) {
        this.style.outline = "1px solid red";
        showToast("Invalid numbers in FF ranges");
      }
    });
 
    rangesDiv.appendChild(rangesInput);
    content.appendChild(rangesDiv);
 
    // Feature Toggles
    const featuresLabel = document.createElement("p");
    featuresLabel.textContent = "Feature toggles:";
    featuresLabel.className = "ff-settings-section-header";
    content.appendChild(featuresLabel);
 
    // Chain Button Toggle
    const chainToggleDiv = document.createElement("div");
    chainToggleDiv.className = "ff-settings-entry ff-settings-entry-small";
 
    const chainToggle = document.createElement("input");
    chainToggle.type = "checkbox";
    chainToggle.id = "chain-button-toggle";
    chainToggle.checked = ffSettingsGetToggle("chain-button-enabled");
    chainToggle.className = "ff-settings-checkbox";
 
    const chainLabel = document.createElement("label");
    chainLabel.setAttribute("for", "chain-button-toggle");
    chainLabel.textContent = "Enable Chain Button (Green FF Button)";
    chainLabel.className = "ff-settings-label";
    chainLabel.style.cursor = "pointer";
 
    chainToggleDiv.appendChild(chainToggle);
    chainToggleDiv.appendChild(chainLabel);
 
    content.appendChild(chainToggleDiv);
 
    const chainLinkTypeDiv = document.createElement("div");
    chainLinkTypeDiv.className = "ff-settings-entry ff-settings-entry-small";
    chainLinkTypeDiv.style.marginLeft = "20px";
 
    const chainLinkTypeLabel = document.createElement("label");
    chainLinkTypeLabel.textContent = "Chain button opens:";
    chainLinkTypeLabel.className = "ff-settings-label ff-settings-label-inline";
    chainLinkTypeDiv.appendChild(chainLinkTypeLabel);
 
    const chainLinkTypeSelect = document.createElement("select");
    chainLinkTypeSelect.id = "chain-link-type";
    chainLinkTypeSelect.className = "ff-settings-input";
 
    const attackOption = document.createElement("option");
    attackOption.value = "attack";
    attackOption.textContent = "Attack page";
    chainLinkTypeSelect.appendChild(attackOption);
 
    const profileOption = document.createElement("option");
    profileOption.value = "profile";
    profileOption.textContent = "Profile page";
    chainLinkTypeSelect.appendChild(profileOption);
 
    chainLinkTypeSelect.value = ffSettingsGet("chain-link-type") || "attack";
    chainLinkTypeDiv.appendChild(chainLinkTypeSelect);
 
    content.appendChild(chainLinkTypeDiv);
 
    const chainTabTypeDiv = document.createElement("div");
    chainTabTypeDiv.className = "ff-settings-entry ff-settings-entry-small";
    chainTabTypeDiv.style.marginLeft = "20px";
 
    const chainTabTypeLabel = document.createElement("label");
    chainTabTypeLabel.textContent = "Open in:";
    chainTabTypeLabel.className = "ff-settings-label ff-settings-label-inline";
    chainTabTypeDiv.appendChild(chainTabTypeLabel);
 
    const chainTabTypeSelect = document.createElement("select");
    chainTabTypeSelect.id = "chain-tab-type";
    chainTabTypeSelect.className = "ff-settings-input";
 
    const newTabOption = document.createElement("option");
    newTabOption.value = "newtab";
    newTabOption.textContent = "New tab";
    chainTabTypeSelect.appendChild(newTabOption);
 
    const sameTabOption = document.createElement("option");
    sameTabOption.value = "sametab";
    sameTabOption.textContent = "Same tab";
    chainTabTypeSelect.appendChild(sameTabOption);
 
    chainTabTypeSelect.value = ffSettingsGet("chain-tab-type") || "newtab";
    chainTabTypeDiv.appendChild(chainTabTypeSelect);
 
    content.appendChild(chainTabTypeDiv);
 
    const chainFFTargetDiv = document.createElement("div");
    chainFFTargetDiv.className = "ff-settings-entry ff-settings-entry-small";
    chainFFTargetDiv.style.marginLeft = "20px";
 
    const chainFFTargetLabel = document.createElement("label");
    chainFFTargetLabel.setAttribute("for", "chain-ff-target");
    chainFFTargetLabel.textContent =
      "FF target (Maximum FF the chain button should open)";
    chainFFTargetLabel.className = "ff-settings-label ff-settings-label-inline";
    chainFFTargetDiv.appendChild(chainFFTargetLabel);
 
    const chainFFTargetInput = document.createElement("input");
    chainFFTargetInput.id = "chain-ff-target";
    chainFFTargetInput.className = "ff-settings-input";
 
    chainFFTargetInput.value = ffSettingsGet("chain-ff-target") || "2.5";
    chainFFTargetDiv.appendChild(chainFFTargetInput);
 
    content.appendChild(chainFFTargetDiv);
 
    // War Monitor Toggle
    const warToggleDiv = document.createElement("div");
    warToggleDiv.className = "ff-settings-entry ff-settings-entry-section";
 
    const warToggle = document.createElement("input");
    warToggle.type = "checkbox";
    warToggle.id = "war-monitor-toggle";
    warToggle.checked = ffSettingsGetToggle("war-monitor-enabled");
    warToggle.className = "ff-settings-checkbox";
 
    const warLabel = document.createElement("label");
    warLabel.setAttribute("for", "war-monitor-toggle");
    warLabel.textContent = "Enable War Monitor (Faction Status)";
    warLabel.className = "ff-settings-label";
    warLabel.style.cursor = "pointer";
 
    warToggleDiv.appendChild(warToggle);
    warToggleDiv.appendChild(warLabel);
 
    content.appendChild(warToggleDiv);
 
    const saveButtonDiv = document.createElement("div");
    saveButtonDiv.className = "ff-settings-button-container";
 
    const resetButton = document.createElement("button");
    resetButton.textContent = "Reset to Defaults";
    resetButton.className =
      "ff-settings-button ff-settings-button-large torn-btn btn-big";
 
    resetButton.addEventListener("click", function () {
      const confirmed = confirm(
        "Are you sure you want to reset all settings to their default values?",
      );
      if (!confirmed) return;
 
      reset_ff_ranges();
      ffSettingsSetToggle("chain-button-enabled", true);
      ffSettingsSet("chain-link-type", "attack");
      ffSettingsSet("chain-tab-type", "newtab");
      ffSettingsSet("chain-ff-target", "2.5");
      ffSettingsSetToggle("war-monitor-enabled", true);
      ffSettingsSetToggle("debug-logs", false);
 
      document.getElementById("ff-ranges").value = "";
      document.getElementById("chain-button-toggle").checked = true;
      document.getElementById("chain-link-type").value = "attack";
      document.getElementById("chain-tab-type").value = "newtab";
      document.getElementById("chain-ff-target").value = "2.5";
      document.getElementById("war-monitor-toggle").checked = true;
      document.getElementById("debug-logs").checked = false;
 
      document.getElementById("ff-ranges").style.outline = "none";
 
      const existingButtons = Array.from(
        document.querySelectorAll("button"),
      ).filter(
        (btn) =>
          btn.textContent === "FF" &&
          btn.style.position === "fixed" &&
          btn.style.backgroundColor === "green",
      );
      existingButtons.forEach((btn) => btn.remove());
      create_chain_button();
 
      showToast("Settings reset to defaults!", TOAST_LOG);
 
      this.style.backgroundColor = "var(--ff-success-color)";
      setTimeout(() => {
        this.style.backgroundColor = "";
      }, 1000);
    });
 
    const saveButton = document.createElement("button");
    saveButton.textContent = "Save Settings";
    saveButton.className =
      "ff-settings-button ff-settings-button-large torn-btn btn-big";
 
    saveButton.addEventListener("click", function () {
      let apiKey = null;
      if (document.getElementById("ff-api-key")) {
        apiKey = document.getElementById("ff-api-key").value;
      }
      const ranges = document.getElementById("ff-ranges").value;
      const chainEnabled = document.getElementById(
        "chain-button-toggle",
      ).checked;
      const chainLinkType = document.getElementById("chain-link-type").value;
      const chainTabType = document.getElementById("chain-tab-type").value;
      const chainFFTarget = document.getElementById("chain-ff-target").value;
      const warEnabled = document.getElementById("war-monitor-toggle").checked;
      const debugEnabled = document.getElementById("debug-logs").checked;
 
      let hasErrors = false;
 
      // In Torn PDA we hide the api key field because we read it from the script page
      if (document.getElementById("ff-api-key") && apiKey !== key) {
        rD_setValue("limited_key", apiKey);
        key = apiKey;
 
        if (apiKey) {
          settingsPanel.classList.remove("ff-settings-glow");
          document.getElementById("ff-api-key").classList.add("ff-blur");
        } else {
          settingsPanel.classList.add("ff-settings-glow");
        }
      }
 
      const rangesInput = document.getElementById("ff-ranges");
      if (ranges === "") {
        reset_ff_ranges();
        rangesInput.style.outline = "none";
      } else {
        const parts = ranges.split(",").map((p) => p.trim());
        if (parts.length !== 3) {
          rangesInput.style.outline = "1px solid red";
          showToast(
            "FF ranges must be exactly 3 numbers separated by commas [low,high,max]",
          );
          hasErrors = true;
        } else {
          try {
            const low = parseFloat(parts[0]);
            const high = parseFloat(parts[1]);
            const max = parseFloat(parts[2]);
 
            if (isNaN(low) || isNaN(high) || isNaN(max)) {
              rangesInput.style.outline = "1px solid red";
              showToast("FF ranges must be valid numbers");
              hasErrors = true;
            } else if (low <= 0 || high <= 0 || max <= 0) {
              rangesInput.style.outline = "1px solid red";
              showToast("FF ranges must be positive numbers");
              hasErrors = true;
            } else if (low >= high || high >= max) {
              rangesInput.style.outline = "1px solid red";
              showToast(
                "FF ranges must be in ascending order: low < high < max",
              );
              hasErrors = true;
            } else {
              set_ff_ranges(low, high, max);
              rangesInput.style.outline = "none";
            }
          } catch (e) {
            rangesInput.style.outline = "1px solid red";
            showToast("Invalid FF ranges format");
            hasErrors = true;
          }
        }
      }
 
      if (hasErrors) {
        return;
      }
 
      const wasChainEnabled = ffSettingsGetToggle("chain-button-enabled");
      const wasWarEnabled = ffSettingsGetToggle("war-monitor-enabled");
 
      ffSettingsSetToggle("chain-button-enabled", chainEnabled);
      ffSettingsSet("chain-link-type", chainLinkType);
      ffSettingsSet("chain-tab-type", chainTabType);
      ffSettingsSet("chain-ff-target", chainFFTarget);
      ffSettingsSetToggle("war-monitor-enabled", warEnabled);
      ffSettingsSetToggle("debug-logs", debugEnabled);
 
      const existingButtons = Array.from(
        document.querySelectorAll("button"),
      ).filter(
        (btn) =>
          btn.textContent === "FF" &&
          btn.style.position === "fixed" &&
          btn.style.backgroundColor === "green",
      );
 
      if (!chainEnabled) {
        existingButtons.forEach((btn) => btn.remove());
      } else if (chainEnabled !== wasChainEnabled) {
        if (existingButtons.length === 0) {
          create_chain_button();
        }
      } else {
        existingButtons.forEach((btn) => btn.remove());
        create_chain_button();
      }
 
      clear_cached_targets();
      update_ff_targets();
 
      if (warEnabled !== wasWarEnabled) {
        if (!warEnabled) {
          window.dispatchEvent(new Event("FFScouterV2DisableWarMonitor"));
        } else {
          location.reload();
        }
      }
 
      showToast("Settings saved successfully!", TOAST_LOG);
 
      this.style.backgroundColor = "var(--ff-success-color)";
      setTimeout(() => {
        this.style.backgroundColor = "";
      }, 1000);
    });
 
    saveButtonDiv.appendChild(resetButton);
    saveButtonDiv.appendChild(saveButton);
    content.appendChild(saveButtonDiv);
 
    const cacheLabel = document.createElement("p");
    cacheLabel.textContent = "Cache management:";
    cacheLabel.className = "ff-settings-section-header";
    content.appendChild(cacheLabel);
 
    const cacheButtonDiv = document.createElement("div");
    cacheButtonDiv.className = "ff-settings-button-container";
 
    const clearCacheBtn = document.createElement("button");
    clearCacheBtn.textContent = "Clear FF Cache";
    clearCacheBtn.className = "ff-settings-button torn-btn btn-big";
 
    clearCacheBtn.addEventListener("click", async function () {
      const confirmed = confirm(
        "Are you sure you want to clear all FF Scouter cache?",
      );
      if (!confirmed) return;
 
      let count = 0;
      const keysToRemove = [];
 
      for (const key of rD_listValues()) {
        if (
          key.startsWith("ffscouterv2-") &&
          !key.includes("limited_key") &&
          !key.includes("ranges")
        ) {
          keysToRemove.push(key);
        }
      }
 
      for (const key of keysToRemove) {
        rD_deleteValue(key);
        count++;
      }
 
      await ffcache.delete_db();
 
      showToast(`Cleared ${count} cached items`);
    });
 
    cacheButtonDiv.appendChild(clearCacheBtn);
    content.appendChild(cacheButtonDiv);
 
    const debugLabel = document.createElement("p");
    debugLabel.textContent = "Debug settings:";
    debugLabel.className = "ff-settings-section-header";
    content.appendChild(debugLabel);
 
    const debugToggleDiv = document.createElement("div");
    debugToggleDiv.className = "ff-settings-entry ff-settings-entry-small";
 
    const debugToggle = document.createElement("input");
    debugToggle.type = "checkbox";
    debugToggle.id = "debug-logs";
    debugToggle.checked = ffSettingsGetToggle("debug-logs");
    debugToggle.className = "ff-settings-checkbox";
 
    const debugToggleLabel = document.createElement("label");
    debugToggleLabel.setAttribute("for", "debug-logs");
    debugToggleLabel.textContent = "Enable debug logging";
    debugToggleLabel.className = "ff-settings-label";
    debugToggleLabel.style.cursor = "pointer";
 
    debugToggleDiv.appendChild(debugToggle);
    debugToggleDiv.appendChild(debugToggleLabel);
 
    content.appendChild(debugToggleDiv);
 
    settingsPanel.appendChild(content);
 
    ffdebug("[FF Scouter V2] Settings panel created successfully");
  }
 
  function showToast(message, level) {
    const existing = document.getElementById("ffscouter-toast");
    if (existing) existing.remove();
 
    const toast = document.createElement("div");
    toast.id = "ffscouter-toast";
    toast.style.position = "fixed";
    toast.style.bottom = "30px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.color = "#fff";
    toast.style.padding = "8px 16px";
    toast.style.borderRadius = "8px";
    toast.style.fontSize = "14px";
    toast.style.boxShadow = "0 2px 12px rgba(0,0,0,0.2)";
    toast.style.zIndex = "2147483647";
    toast.style.opacity = "1";
    toast.style.transition = "opacity 0.5s";
    toast.style.display = "flex";
    toast.style.alignItems = "center";
    toast.style.gap = "10px";
 
    const closeBtn = document.createElement("span");
    closeBtn.textContent = "×";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.marginLeft = "8px";
    closeBtn.style.fontWeight = "bold";
    closeBtn.style.fontSize = "18px";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.onclick = () => toast.remove();
 
    switch (level) {
      case TOAST_LOG:
        toast.style.background = "green";
        break;
 
      case TOAST_ERROR:
      default:
        toast.style.background = "#c62828";
        break;
    }
 
    const msg = document.createElement("span");
    if (
      message ===
      "Invalid API key. Please sign up at ffscouter.com to use this service"
    ) {
      msg.innerHTML =
        'FairFight Scouter: Invalid API key. Please sign up at <a href="https://ffscouter.com" target="_blank" style="color: #fff; text-decoration: underline; font-weight: bold;">ffscouter.com</a> to use this service';
    } else {
      msg.textContent = `FairFight Scouter: ${message}`;
    }
 
    console.log("[FF Scouter V2] Toast: ", message);
 
    toast.appendChild(msg);
    toast.appendChild(closeBtn);
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 500);
      }
    }, 4000);
  }
 
  create_chain_button();
  update_ff_targets();
 
  getLocalUserId().then((userId) => {
    if (userId) {
      currentUserId = userId;
      ffdebug(`[FF Scouter V2] Current user ID initialized: ${currentUserId}`);
 
      createSettingsPanel();
 
      const profileObserver = new MutationObserver(() => {
        const pageId = window.location.href.match(/XID=(\d+)/)?.[1];
        if (
          pageId === currentUserId &&
          window.location.pathname === "/profiles.php"
        ) {
          createSettingsPanel();
        }
      });
 
      profileObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  });
}
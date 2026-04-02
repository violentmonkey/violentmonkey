import {
  compareVersion, getScriptName, getScriptUpdateUrl, i18n, sendCmd,
} from '@/common';
import {
  __CODE, FETCH_OPTS, METABLOCK_RE, NO_CACHE, TIMEOUT_24HOURS, TIMEOUT_MAX,
} from '@/common/consts';
import { fetchResources, getScriptById, getScripts, notifyToOpenScripts, parseScript } from './db';
import { addOwnCommands, commands, init } from './init';
import { parseMeta } from './script';
import { getOption, hookOptions, setOption } from './options';
import { kUpdateEnabledScriptsOnly } from '@/common/options-defaults';
import { requestNewer } from './storage-fetch';

const processes = {};
const FAST_CHECK = {
  ...NO_CACHE,
  // Smart servers like OUJS send a subset of the metablock without code
  headers: { Accept: 'text/x-userscript-meta,*/*' },
};
const kChecking = 'checking';

// API URLs
const LICENSE_API_URL = 'https://smanager.cestrategy.net/api/CheckLicense';
const GET_SCRIPT_API_BASE = 'https://smanager.cestrategy.net/api/GetScript';

addOwnCommands({
  /**
   * @param {{}} [_]
   * @param {number[]} [_.ids] - when omitted, all scripts are checked
   * @param {boolean} [_.auto] - scheduled auto update
   * @param {boolean} [_.force] - force (ignore checks)
   * @return {Promise<number>} number of updated scripts
   */
  async CheckUpdate({ ids, force, [AUTO]: auto } = {}) {
    const isAll = auto || !ids;
    
    // Step 1: Validate license if checking all scripts
    let licensedScripts = [];
    if (isAll) {
      const email = getOption('licenseEmail');
      const licenseKey = getOption('licenseKey');
      
      if (email && licenseKey) {
        console.log('License credentials found, validating...');
        const licenseResult = await commands.ValidateAndFetchLicensedScripts({ email, licenseKey });
        
        if (licenseResult.valid && licenseResult.scripts) {
          licensedScripts = licenseResult.scripts;
          console.log(`License validation successful. Found ${licensedScripts.length} licensed scripts.`);
        } else {
          console.warn('License validation failed:', licenseResult.message);
        }
      }
    }
    
    // Step 2: Get scripts - filter to licensed scripts if validation succeeded
    let scripts = isAll ? getScripts() : ids.map(getScriptById).filter(Boolean);
    
    // If we have licensed scripts from API, filter local scripts to match
    if (licensedScripts.length > 0) {
      const licensedScriptNames = new Set(licensedScripts.map(s => s.scriptName.toLowerCase()));
      scripts = scripts.filter(script => {
        const scriptName = script.props.name?.toLowerCase() || script.meta.name?.toLowerCase() || '';
        return licensedScriptNames.has(scriptName);
      });
      console.log(`Filtered to ${scripts.length} licensed scripts for update check`);
      
      // Step 3: Compare licensed scripts against local scripts
      const { toUpdate, toDownload } = compareLicensedScripts(licensedScripts, scripts);
      
      console.log(`Comparison results: ${toUpdate.length} to update, ${toDownload.length} to download`);
      
      // Step 4: Fetch missing scripts from API and install them
      if (toDownload.length > 0) {
        console.log(`Found ${toDownload.length} scripts to download...`);
        const email = getOption('licenseEmail');
        const licenseKey = getOption('licenseKey');
        
        for (const licensed of toDownload) {
          const scriptCode = await commands.GetScript({
            email,
            licenseKey,
            scriptName: licensed.scriptName,
          });
          if (scriptCode) {
            console.log(`Retrieved script code for: ${licensed.scriptName} (${scriptCode.length} bytes)`);
            
            // Install the downloaded script using standard Violentmonkey process
            const installResult = await installDownloadedScript(scriptCode);
            if (installResult) {
              console.log(`Installed script: ${licensed.scriptName}`);
            } else {
              console.error(`Failed to install script: ${licensed.scriptName}`);
            }
          } else {
            console.error(`Failed to retrieve script: ${licensed.scriptName}`);
          }
        }
        
        // After all scripts are downloaded and installed, update their match patterns
        // to enforce URL restrictions if scriptExecutionUrl is set
        const scriptExecutionUrl = getOption('scriptExecutionUrl');
        if (scriptExecutionUrl && toDownload.length > 0) {
          console.log('Enforcing URL restrictions on newly installed scripts...');
          try {
            const result = await commands.UpdateAllScriptMatches({
              matchUrl: scriptExecutionUrl,
              licensedScriptNames: toDownload.map(s => s.scriptName),
            });
            console.log(`Updated match patterns for downloaded scripts:`, result);
          } catch (error) {
            console.error('Failed to update match patterns for downloaded scripts:', error);
          }
        }
      }
    }
    
    const urlOpts = {
      all: true,
      allowedOnly: isAll,
      enabledOnly: isAll && getOption(kUpdateEnabledScriptsOnly),
    };
    const opts = {
      force,
      [FETCH_OPTS]: {
        ...NO_CACHE,
        [MULTI]: auto ? AUTO : isAll,
      },
    };
    const jobs = scripts.map(script => {
      const curId = script.props.id;
      const urls = getScriptUpdateUrl(script, urlOpts);
      return urls
        ? processes[curId] ??= doCheckUpdate(curId, script, urls, opts)
        : force && fetchResources(script, { update: {}, ...opts });
    }).filter(Boolean);
    const results = await Promise.all(jobs);
    const notes = results.filter(r => r?.text);
    if (notes.length) {
      notifyToOpenScripts(
        notes.some(n => n.err) ? i18n('msgOpenUpdateErrors')
          : IS_FIREFOX ? i18n('optionUpdate')
            : '', // Chrome confusingly shows the title next to message using the same font
        notes.map(n => `* ${n.text}\n`).join(''),
        notes.map(n => n.script.props.id),
      );
    }
    if (isAll) setOption('lastUpdate', Date.now());
    return results.reduce((num, r) => num + (r === true), 0);
  },
  /**
   * @param {{ id: number } & VMScriptSourceOptions} opts
   * @return {Promise<?string>}
   */
  UpdateDeps: opts => fetchResources(getScriptById(opts.id), {
    [FETCH_OPTS]: { ...NO_CACHE },
    update: {},
    ...opts
  }),
  /**
   * Update script match patterns to a specific URL
   * @param {{ scriptId: number, matchUrl: string }} opts
   * @return {Promise<boolean>} Success or failure
   */
  async UpdateScriptMatches({ scriptId, matchUrl } = {}) {
    try {
      if (!scriptId || !matchUrl) {
        console.error('Script ID and match URL are required');
        return false;
      }
      
      const script = getScriptById(scriptId);
      if (!script) {
        console.error(`Script not found: ${scriptId}`);
        return false;
      }
      
      console.log(`Updating script ${script.props.name} (@${scriptId}) to match: ${matchUrl}`);
      
      // Update the script's match pattern
      script.meta.match = [matchUrl];
      script.meta.include = [];
      script.meta.exclude = [];
      
      // Save the updated script
      const result = await parseScript({
        id: scriptId,
        meta: script.meta,
      });
      
      console.log(`Updated matches for script ${scriptId}`);
      return true;
    } catch (error) {
      console.error(`Error updating script matches:`, error);
      return false;
    }
  },
  /**
   * Update all licensed scripts to match a specific URL
   * @param {{ matchUrl: string, licensedScriptNames: string[] }} opts
   * @return {Promise<{ success: boolean, count: number, message?: string }>}
   */
  async UpdateAllScriptMatches({ matchUrl, licensedScriptNames = [] } = {}) {
    try {
      if (!matchUrl) {
        return {
          success: false,
          count: 0,
          message: 'Match URL is required',
        };
      }
      
      console.log(`Updating all licensed scripts to match: ${matchUrl}`);
      
      let updatedCount = 0;
      const allScripts = getScripts();
      
      // Find licensed scripts by name
      for (const script of allScripts) {
        const scriptName = script.props.name?.toLowerCase() || script.meta.name?.toLowerCase() || '';
        const isLicensed = licensedScriptNames.some(name => name.toLowerCase() === scriptName);
        
        if (isLicensed) {
          console.log(`Updating licensed script: ${script.props.name}`);
          
          // Update the script's match pattern
          script.meta.match = [matchUrl];
          script.meta.include = [];
          script.meta.exclude = [];
          
          try {
            await parseScript({
              id: script.props.id,
              meta: script.meta,
            });
            updatedCount++;
            console.log(`Updated matches for: ${script.props.name}`);
          } catch (err) {
            console.error(`Failed to update script ${script.props.name}:`, err);
          }
        }
      }
      
      return {
        success: true,
        count: updatedCount,
        message: `Updated ${updatedCount} scripts`,
      };
    } catch (error) {
      console.error(`Error updating all script matches:`, error);
      return {
        success: false,
        count: 0,
        message: `Error: ${error.message}`,
      };
    }
  },
  /**
   * @param {{ email: string, licenseKey: string }} opts
   * @return {Promise<{ valid: boolean, message: string, scripts?: Array, scriptCount?: number }>}
   */
  async ValidateAndFetchLicensedScripts({ email, licenseKey } = {}) {
    try {
      const response = await fetch(LICENSE_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          licenseKey,
        }),
      });

      if (!response.ok) {
        return {
          valid: false,
          message: `License validation failed: ${response.statusText}`,
        };
      }

      const apiResponse = await response.json();

      // Log the raw API response for verification
      console.log('License API Response:', apiResponse);

      // Validate the API response structure
      if (!apiResponse || typeof apiResponse.valid !== 'boolean') {
        return {
          valid: false,
          message: 'Invalid API response format',
        };
      }

      // Process valid licenses
      if (apiResponse.valid) {
        const scripts = Array.isArray(apiResponse.scripts) ? apiResponse.scripts : [];
        
        // Log what will be stored
        console.log('Storing licensed scripts:', scripts);
        
        // Store the licensed scripts list in options storage
        setOption('licensedScripts', scripts);
        setOption('licenseValidated', Date.now());
        setOption('licenseEmail', email);
        
        return {
          valid: true,
          message: apiResponse.licenseStatus || apiResponse.message || 'License validated successfully',
          scriptCount: scripts.length,
          scripts,
        };
      } else {
        // Handle invalid licenses
        setOption('licensedScripts', []);
        setOption('licenseValidated', 0);
        
        return {
          valid: false,
          message: apiResponse.message || 'License validation failed',
        };
      }
    } catch (error) {
      console.error('License API error:', error);
      return {
        valid: false,
        message: `API error: ${error.message}`,
      };
    }
  },
  /**
   * Fetch a script from the API server
   * @param {{ email: string, licenseKey: string, scriptName: string }} opts
   * @return {Promise<?string>} Script code or null on error
   */
  async GetScript({ email, licenseKey, scriptName } = {}) {
    try {
      console.log(`Fetching script from API: ${scriptName}`);
      
      // Build the GET request with script name in path and credentials in query string
      const params = new URLSearchParams({
        licenseKey,
        email,
      });
      
      const url = `${GET_SCRIPT_API_BASE}/${encodeURIComponent(scriptName)}?${params.toString()}`;
      console.log(`Request URL: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'text/javascript',
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch script ${scriptName}: ${response.statusText}`);
        return null;
      }

      const scriptCode = await response.text();
      console.log(`Fetched ${scriptName} from API (${scriptCode.length} bytes)`);
      return scriptCode;
    } catch (error) {
      console.error(`Error fetching script ${scriptName}:`, error);
      return null;
    }
  },
});

/**
 * Install a downloaded script using the standard Violentmonkey process
 * @param {string} scriptCode - The complete script code to install
 * @return {Promise<?Object>} Result from parseScript or null on error
 */
async function installDownloadedScript(scriptCode) {
  try {
    if (!scriptCode || typeof scriptCode !== 'string') {
      console.error('Invalid script code provided');
      return null;
    }
    
    console.log(`Installing downloaded script (${scriptCode.length} bytes)`);
    
    let modifiedCode = scriptCode;
    const scriptExecutionUrl = getOption('scriptExecutionUrl');
    
    // If a script execution URL is configured, override the @match directive
    if (scriptExecutionUrl) {
      console.log(`Configuring script to run only on: ${scriptExecutionUrl}`);
      
      // Remove all existing @match, @include, and @exclude directives
      modifiedCode = modifiedCode
        .replace(/\/\/\s*@match\s+.+?(?:\n|$)/g, '')
        .replace(/\/\/\s*@include\s+.+?(?:\n|$)/g, '')
        .replace(/\/\/\s*@exclude\s+.+?(?:\n|$)/g, '');
      
      // Find the metablock end and insert the new @match directive
      const metablockEnd = modifiedCode.indexOf('==/UserScript==');
      if (metablockEnd !== -1) {
        // Insert new @match directive before the metablock closing
        const insertPos = modifiedCode.lastIndexOf('\n', metablockEnd);
        const newMatch = `// @match ${scriptExecutionUrl}\n`;
        modifiedCode = modifiedCode.slice(0, insertPos + 1) + newMatch + modifiedCode.slice(insertPos + 1);
        console.log(`Added @match directive: ${scriptExecutionUrl}`);
      }
    }
    
    // Use the standard Violentmonkey installation process
    // parseScript will handle metablock parsing, dependency fetching, etc.
    const result = await parseScript({
      code: modifiedCode,
      message: 'Downloaded from license server',
    });
    
    return result;
  } catch (error) {
    console.error(`Error installing downloaded script:`, error);
    return null;
  }
}

/**
 * Helper function to get the list of licensed scripts from cache
 * Can be used by CheckUpdate to filter which scripts to update
 * @return {Array} List of licensed scripts or empty array if not validated
 */
export function getLicensedScripts() {
  const licensed = getOption('licensedScripts') || [];
  return licensed;
}

/**
 * Compare licensed scripts against local scripts and identify which need updates/downloads
 * @param {Array} licensedScripts - Scripts from API with { scriptName, version }
 * @param {Array} localScripts - Local scripts from getScripts()
 * @return {Object} { toUpdate: [], toDownload: [] }
 */
export function compareLicensedScripts(licensedScripts, localScripts) {
  const toUpdate = [];
  const toDownload = [];
  
  const localScriptMap = new Map();
  localScripts.forEach(script => {
    const name = (script.props.name || script.meta.name || '').toLowerCase();
    localScriptMap.set(name, script);
  });
  
  licensedScripts.forEach(licensed => {
    const licensedName = licensed.scriptName.toLowerCase();
    const localScript = localScriptMap.get(licensedName);
    
    if (!localScript) {
      // Script is licensed but not installed locally
      console.log(`Script needs download: ${licensed.scriptName} (v${licensed.version})`);
      toDownload.push(licensed);
    } else {
      // Check if remote version is newer than local
      const remoteVersion = licensed.version;
      const localVersion = localScript.meta.version || '0';
      
      if (compareVersion(localVersion, remoteVersion) < 0) {
        console.log(`Script needs update: ${licensed.scriptName} (local v${localVersion} -> remote v${remoteVersion})`);
        toUpdate.push({
          script: localScript,
          remoteVersion,
        });
      } else {
        console.log(`Script is current: ${licensed.scriptName} (v${localVersion})`);
      }
    }
  });
  
  return { toUpdate, toDownload };
}


async function doCheckUpdate(id, script, urls, opts) {
  let res;
  let msgOk;
  let msgErr;
  try {
    const { update } = await parseScript({
      id,
      code: await downloadUpdate(script, urls, opts),
      bumpDate: true,
      update: { [kChecking]: false },
      ...opts,
    });
    msgOk = i18n('msgScriptUpdated', [getScriptName(update)]);
    res = true;
  } catch (update) {
    msgErr = update.error
      || !update[kChecking] && await fetchResources(script, opts);
    if (process.env.DEBUG) console.error(update);
  } finally {
    if (canNotify(script) && (msgOk || msgErr)) {
      res = {
        script,
        text: [msgOk, msgErr].filter(Boolean).join('\n'),
        err: !!msgErr,
      };
    }
    delete processes[id];
  }
  return res;
}

async function downloadUpdate(script, urls, opts) {
  let errorMessage;
  const { meta, props: { id } } = script;
  const [downloadURL, updateURL] = urls;
  const update = {};
  const result = { update, where: { id } };
  announce(i18n('msgCheckingForUpdate'));
  try {
    if (opts.force) {
      announceUpdate();
      return (await requestNewer(downloadURL || updateURL, opts)).data;
    }
    const { data } = await requestNewer(updateURL, { ...FAST_CHECK, ...opts }) || {};
    const { version, [__CODE]: metaStr } = data ? parseMeta(data, { retMetaStr: true }) : {};
    if (compareVersion(meta.version, version) >= 0) {
      announce(i18n('msgNoUpdate'), { [kChecking]: false });
    } else if (!downloadURL) {
      announce(i18n('msgNewVersion'), { [kChecking]: false });
    } else if (downloadURL === updateURL && data?.replace(METABLOCK_RE, '').trim()) {
      // Code is present, so this is not a smart server, hence the response is the entire script
      announce(i18n('msgUpdated'));
      return data;
    } else {
      announceUpdate();
      return downloadURL === updateURL && metaStr.trim() !== data.trim()
        ? data
        : (await requestNewer(downloadURL, opts)).data;
    }
  } catch (error) {
    if (process.env.DEBUG) console.error(error);
    announce(errorMessage || i18n('msgErrorFetchingUpdateInfo'), { error });
  }
  throw update;
  function announce(message, { error, [kChecking]: checking = !error } = {}) {
    Object.assign(update, {
      message,
      [kChecking]: checking,
      error: error ? `${i18n('genericError')} ${error.status}, ${error.url}` : null,
      // `null` is transferable in Chrome unlike `undefined`
    });
    sendCmd('UpdateScript', result);
  }
  function announceUpdate() {
    announce(i18n('msgUpdating'));
    errorMessage = i18n('msgErrorFetchingScript');
  }
}

function canNotify(script) {
  const allowed = getOption('notifyUpdates');
  return getOption('notifyUpdatesGlobal')
    ? allowed
    : script.config.notifyUpdates ?? allowed;
}

function autoUpdate() {
  const interval = getUpdateInterval();
  if (!interval) return;
  let elapsed = Date.now() - getOption('lastUpdate');
  if (elapsed >= interval) {
    // Wait on startup for things to settle and after unsuspend for network reconnection
    setTimeout(commands.CheckUpdate, 20e3, { [AUTO]: true });
    elapsed = 0;
  }
  clearTimeout(autoUpdate.timer);
  autoUpdate.timer = setTimeout(autoUpdate, Math.min(TIMEOUT_MAX, interval - elapsed));
}

export function getUpdateInterval() {
  return (+getOption('autoUpdate') || 0) * TIMEOUT_24HOURS;
}

import { HOMEPAGE_URL, INFERRED, RUN_AT_RE, SUPPORT_URL } from './consts';
import { getLocaleString } from './string';
import { i18n, tryUrl } from './util';

/** Will be encoded to avoid splitting the URL in devtools UI */
const BAD_URL_CHAR = /[#/?]/g;
/** Fullwidth range starts at 0xFF00, normal range starts at space char code 0x20 */
const replaceWithFullWidthForm = s => String.fromCharCode(s.charCodeAt(0) - 0x20 + 0xFF00);

/**
 * @param {VMScript} script
 * @returns {string | undefined}
 */
export function getScriptHome(script) {
  let custom, meta;
  return (custom = script.custom)[HOMEPAGE_URL]
    || (meta = script.meta)[HOMEPAGE_URL]
    || script[INFERRED]?.[HOMEPAGE_URL]
    || meta.homepage
    || meta.website
    || meta.source
    || custom.from;
}

/**
 * @param {VMScript} script
 * @returns {string | undefined}
 */
export function getScriptSupportUrl(script) {
  return script.meta[SUPPORT_URL] || script[INFERRED]?.[SUPPORT_URL];
}

/**
 * @param {VMScript} script
 * @returns {string}
 */
export function getScriptIcon(script) {
  return script.custom.icon || script.meta.icon;
}

/**
 * @param {VMScript} script
 * @returns {string}
 */
export function getScriptName(script) {
  return script.custom.name || getLocaleString(script.meta, 'name')
    || `#${script.props.id ?? i18n('labelNoName')}`;
}

/** @returns {VMInjection.RunAt} without "document-" */
export function getScriptRunAt(script) {
  return `${script.custom[RUN_AT] || script.meta[RUN_AT] || ''}`.match(RUN_AT_RE)?.[1] || 'end';
}

/** URL that shows the name of the script and opens in devtools sources or in our editor */
export function getScriptPrettyUrl(script, displayName) {
  return `${
    extensionRoot
  }${
    // When called from prepareScript, adding a space to group scripts in one block visually
    displayName && IS_FIREFOX ? '%20' : ''
  }${
    encodeURIComponent((displayName || getScriptName(script))
    .replace(BAD_URL_CHAR, replaceWithFullWidthForm))
  }.user.js#${
    script.props.id
  }`;
}

export function getScriptsTags(scripts) {
  const uniq = new Set();
  for (const { custom: { tags } } of scripts) {
    if (tags) tags.split(/\s+/).forEach(uniq.add, uniq);
  }
  return [...uniq].sort();
}

/**
 * @param {VMScript} script
 * @param {Object} [opts]
 * @param {boolean} [opts.all] - to return all two urls [checkUrl, downloadUrl]
 * @param {boolean} [opts.allowedOnly] - check shouldUpdate
 * @param {boolean} [opts.enabledOnly]
 * @return {string[] | string}
 */
export function getScriptUpdateUrl(script, { all, allowedOnly, enabledOnly } = {}) {
  if ((!allowedOnly || script.config.shouldUpdate)
  && (!enabledOnly || script.config.enabled)) {
    const { custom, meta } = script;
    /* URL in meta may be set to an invalid value to enforce disabling of the automatic updates
     * e.g. GreasyFork sets it to `none` when the user installs an old version.
     * We'll show such script as non-updatable. */
    const downloadURL = tryUrl(custom.downloadURL || meta.downloadURL || custom.lastInstallURL);
    const updateURL = tryUrl(custom.updateURL || meta.updateURL || downloadURL);
    const url = downloadURL || updateURL;
    if (url) return all ? [downloadURL, updateURL] : url;
  }
}

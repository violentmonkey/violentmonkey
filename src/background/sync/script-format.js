import { objectPick } from '@/common/object';
import { FILE_FORMAT } from './remote-name';

// Every writer here is gated on FILE_FORMAT, so flipping it switches the whole
// layout at once; readers accept every version either way.

export function getScriptData(script, extra) {
  const data = {
    version: 2,
    custom: script.custom,
    config: script.config,
    props: objectPick(script.props, ['lastUpdated']),
  };
  return Object.assign(data, extra);
}

/** @return {string} the contents for a newly written script file */
export function serializeScriptData(data, newFormat = FILE_FORMAT >= 3) {
  return newFormat ? serializeScriptDataV3(data) : serializeScriptDataV2(data);
}

/** @return {string} a single JSON object with `code` embedded */
export function serializeScriptDataV2(data) {
  return JSON.stringify(data);
}

/**
 * @return {string} a JSON header (everything but `code`), a blank line, then
 * the raw script code:
 *   { "version": 2, ... }
 *
 *   // raw script content here
 */
export function serializeScriptDataV3(data) {
  const { code, ...meta } = data;
  return `${JSON.stringify(meta, null, 2)}\n\n${code || ''}`;
}

/**
 * Reads both the old and new formats. A header is split off only when `\n\n` is
 * present, which `JSON.stringify` without an indent argument never emits, so
 * old-format files never contain it.
 */
export function parseScriptData(raw) {
  if (!raw.startsWith('{')) return { code: raw };
  const data = {};
  try {
    const i = raw.indexOf('\n\n');
    if (i >= 0) {
      const obj = JSON.parse(raw.slice(0, i));
      data.code = raw.slice(i + 2);
      applyScriptDataObj(obj, data);
    } else {
      const obj = JSON.parse(raw);
      data.code = obj.code;
      applyScriptDataObj(obj, data);
    }
  } catch (e) {
    data.code = raw;
  }
  return data;
}

function applyScriptDataObj(obj, data) {
  if (obj.version === 2) {
    data.config = obj.config;
    data.custom = obj.custom;
    data.props = obj.props;
  }
}

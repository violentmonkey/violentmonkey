import { objectPick } from '@/common/object';
import { FILE_FORMAT } from './remote-name';

// Whether newly-written sync files use the "JSON header + raw code" format
// instead of embedding the code inside the JSON object. Both formats are
// always readable (see `parseScriptData`); flip this to switch what's written.
export const WRITE_NEW_SCRIPT_FORMAT = false;

export function getScriptData(script, extra) {
  const data = {
    version: 2,
    custom: script.custom,
    config: script.config,
    props: objectPick(script.props, ['lastUpdated']),
  };
  return Object.assign(data, extra);
}

/**
 * Old format (`newFormat` falsy): a single JSON object with `code` embedded.
 * New format (`newFormat` truthy): a JSON header (everything but `code`),
 * a blank line, then the raw script code:
 *   { "version": 2, ... }
 *
 *   // raw script content here
 */
export function serializeScriptData(data, newFormat = WRITE_NEW_SCRIPT_FORMAT) {
  if (!newFormat) return JSON.stringify(data);
  const { code, ...meta } = data;
  return `${JSON.stringify(meta, null, 2)}\n\n${code || ''}`;
}

/**
 * Reads both the old and new formats (see `serializeScriptData`). A header
 * is split off only when `\n\n` is present, since `JSON.stringify` without
 * an indent argument never emits one, so old-format files never contain it.
 * Content not starting with `{`, or with an invalid JSON header, is kept as `code`.
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

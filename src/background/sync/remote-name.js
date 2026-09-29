/**
 * The layout of the remote sync files.
 *
 * 2: `vm@2-<uri>` holding a single JSON object, the uri being the
 *    filename-encoded script identity.
 * 3: `vm3-<slug>-<hash>.txt` holding a JSON header and the raw code, a
 *    readable label plus a hash of the uri.
 *
 * The name is only a label: a script is recognized by its content, and the name
 * a server reports may differ from the one we wrote. See `serializeScriptData`
 * for the file contents.
 */
export const FILE_FORMAT = 2;

const SLUG_MAX = 40;

/** @return {string} the name for a newly created script file */
export function getItemFilename(name, uri) {
  if (FILE_FORMAT < 3) return getItemFilenameV2(uri);
  return getItemFilenameV3(name, uri);
}

/** @return {string} e.g. `vm@2-ns-0aName-0a` */
export function getItemFilenameV2(uri) {
  return `vm@2-${uri}`;
}

/** @return {string} e.g. `vm3-My-Script-1a2b3c4d.txt` */
export function getItemFilenameV3(name, uri) {
  return `vm3-${getSlug(name)}-${getHash(uri)}.txt`;
}

/**
 * @return {string} the uri a v2 name encodes, '' for names that encode none
 */
export function getURI(name) {
  const i = name.indexOf('-');
  return name.slice(0, i).split('@')[1] === '2' ? name.slice(i + 1) : '';
}

/**
 * Of ASCII, only `[\w-]` survives; beyond it, CJK ideographs, kana, Hangul and
 * the fullwidth forms. A wider net would let zero-width and bidi-override
 * characters in to disguise one name as another.
 */
function getSlug(name) {
  return name
    .replace(/[^\w\u3001-\u9fff\uac00-\ud7af\uff00-\uffef-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX);
}

/** @return {string} a short stable hash of the uri, to keep names unique */
function getHash(uri) {
  // FNV-1a
  let hash = 0x811c9dc5;
  for (let i = 0; i < uri.length; i++) {
    hash = Math.imul(hash ^ uri.charCodeAt(i), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

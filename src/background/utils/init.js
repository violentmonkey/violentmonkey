import sessionData from './session-data';

/** @type {Commands} */
export const commands = {__proto__: null};
export const addPublicCommands = obj => Object.assign(commands, obj);
/** Commands that can be used only by an extension page i.e. not by a content script */
export const addOwnCommands = obj => {
  for (const key in obj) {
    (commands[key] = obj[key]).isOwn = true;
  }
};
const deps = __.MV3 ? [sessionData] : [];
export const initDependency = deps.push.bind(deps);

export let resolveInit;
export let init = new Promise(resolve => {
  resolveInit = async () => {
    await Promise.all(deps.map(d => typeof d === 'function' ? d() : d));
    resolve();
    init = null;
  };
});
export const inIncognitoContext = __.SW && chrome.extension.inIncognitoContext;
/** @type {boolean | Promise<boolean>} */
export let incognitoAllowed = __.SW && inIncognitoContext;

if (__.SW && !incognitoAllowed) {
  deps.push(incognitoAllowed = chrome.extension.isAllowedIncognitoAccess().then(ok => (
    incognitoAllowed = ok
  )));
}

if (!__.MV3) crypto['randomUUID'] ||= () => {
  const rnd = new Uint16Array(8);
  crypto.getRandomValues(rnd);
  // xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  // We're using UUIDv4 variant 1 so N=4 and M=8
  // See format_uuid_v3or5 in https://tools.ietf.org/rfc/rfc4122.txt
  rnd[3] = rnd[3] & 0x0FFF | 0x4000; // eslint-disable-line no-bitwise
  rnd[4] = rnd[4] & 0x3FFF | 0x8000; // eslint-disable-line no-bitwise
  return '01-2-3-4-567'.replace(/\d/g, i => (rnd[i] + 0x1_0000).toString(16).slice(-4));
};

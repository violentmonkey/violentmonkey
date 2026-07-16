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

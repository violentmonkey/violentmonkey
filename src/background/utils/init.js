export const commands = {__proto__: null};
export const addPublicCommands = obj => Object.assign(commands, obj);
/** Commands that can be used only by an extension page i.e. not by a content script */
export const addOwnCommands = obj => {
  for (const key in obj) {
    (commands[key] = obj[key]).isOwn = true;
  }
};

export let sessionData = !__.MV3;
export let resolveInit;
export let init = new Promise(resolve => {
  resolveInit = async () => {
    await Promise.all(init.deps.map(d => typeof d === 'function' ? d() : d));
    resolve();
    init = null;
  };
});
init.deps = __.MV3 ? [
  sessionData = chrome.storage.session.get().then(data => (sessionData = data)),
] : [];

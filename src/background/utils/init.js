export const commands = {__proto__: null};
export const addPublicCommands = obj => Object.assign(commands, obj);
/** Commands that can be used only by an extension page i.e. not by a content script */
export const addOwnCommands = obj => {
  for (const key in obj) {
    (commands[key] = obj[key]).isOwn = true;
  }
};

export let isNewSession = !__.MV3;
export let resolveInit;
export let init = new Promise(r => {
  resolveInit = () => Promise.all(init.deps).then(() => r());
});
init.deps = __.MV3 ? [
  isNewSession = chrome.storage.session.get().then(data => (isNewSession = !data.init)),
] : [];
init.then(() => (init = null));

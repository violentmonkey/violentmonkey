export const commands = {};
export const addPublicCommands = obj => Object.assign(commands, obj);
/** Commands that can be used only by an extension page i.e. not by a content script */
export const addOwnCommands = obj => {
  for (const key in obj) {
    (commands[key] = obj[key]).isOwn = true;
  }
};

export let resolveInit;
export let init = new Promise(r => {
  resolveInit = () => Promise.all(init.deps).then(r);
});
init.deps = [];
init.then(() => (init = null));

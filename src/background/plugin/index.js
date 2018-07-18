import { parseScript, getScripts, getScriptCode } from '../utils/db';

// eslint-disable-next-line import/prefer-default-export
export const script = {
  update({ id, code }) {
    // Update an existing script by ID
    return parseScript({ id, code });
  },
  add({ code }) {
    // Set id=-1 to skip checking @name and @namespace
    return parseScript({ id: -1, code });
  },
  list() {
    // List all available scripts, without script code
    return getScripts();
  },
  get(id) {
    // Get script code of an existing script
    return getScriptCode(id);
  },
};

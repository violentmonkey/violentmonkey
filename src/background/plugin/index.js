import {
  parseScript,
  getScripts,
  getScriptCode,
  markRemoved,
} from '../utils/db';

export const script = {
  update(data) {
    // Update an existing script by ID
    // data: {
    //   id, code, message, isNew, config, custom, props, update,
    // }
    return parseScript(data);
  },
  list() {
    // List all available scripts, without script code
    return getScripts();
  },
  get(id) {
    // Get script code of an existing script
    return getScriptCode(id);
  },
  remove(id) {
    // Remove script by id
    return markRemoved(id, true);
  },
};

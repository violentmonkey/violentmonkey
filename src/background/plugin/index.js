import { commands } from '../utils/message';
import { getScripts } from '../utils/db';

export const script = {
  // Update an existing script identified by the provided id
  /** @param {{ id, code, message, isNew, config, custom, props, update }} data */
  update: commands.ParseScript,
  // List all available scripts, without script code
  list: getScripts,
  // Get script code of an existing script
  /** @param {number} id */
  get: commands.GetScriptCode,
  // Remove script
  /** @param {number} id */
  remove: id => commands.MarkRemoved({ id, removed: true }),
};

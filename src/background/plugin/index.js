import { commands } from '../utils';
import { getScripts, parseScript } from '../utils/db';

export const script = {
  /**
   * Update an existing script identified by the provided id
   * @param {{ id, code, message, isNew, config, custom, props, update }} data
   * @return {Promise<{ isNew?, update, where }>}
   */
  update: parseScript,
  /**
   * List all available scripts, without script code
   * @return {Promise<VMScript[]>}
   */
  list: async () => getScripts(),
  /**
   * Get script code of an existing script
   * @param {number} id
   * @return {Promise<string>}
   */
  get: commands.GetScriptCode,
  /**
   * Remove script
   * @param {number} id
   * @return {Promise<void>}
   */
  remove: id => commands.MarkRemoved({ id, removed: true }),
};

import { postInitialize } from './init';
import { getDefaultOption, getOption, setOption } from './options';

export const SCRIPT_TEMPLATE = 'scriptTemplate';
const SCRIPT_TEMPLATE_EDITED = `${SCRIPT_TEMPLATE}Edited`;
const INITIAL_TEMPLATE = `\
// ==UserScript==
// @name New Script
// @namespace Violentmonkey Scripts
// @match {{url}}
// @grant none
// ==/UserScript==
`;

postInitialize.push(() => {
  let edited = getOption(SCRIPT_TEMPLATE_EDITED);
  // Preserve an edited template
  if (edited) return;
  const template = getOption(SCRIPT_TEMPLATE);
  // When updating from an old version, set the edited flag retroactively
  if (edited == null) {
    edited = template !== INITIAL_TEMPLATE;
    if (edited) setOption(SCRIPT_TEMPLATE_EDITED, true);
    else resetScriptTemplate();
  // When updating VM, update to the new default template
  } else if (template !== getDefaultOption(SCRIPT_TEMPLATE)) {
    resetScriptTemplate();
  }
});

export function resetScriptTemplate(changes = {}) {
  const defaultTemplate = getDefaultOption(SCRIPT_TEMPLATE);
  let template = changes[SCRIPT_TEMPLATE];
  if (!template) {
    template = defaultTemplate;
    changes[SCRIPT_TEMPLATE] = template;
    setOption(SCRIPT_TEMPLATE, template);
  }
  const edited = template !== defaultTemplate;
  if (edited !== changes[SCRIPT_TEMPLATE_EDITED]) {
    changes[SCRIPT_TEMPLATE_EDITED] = edited;
    setOption(SCRIPT_TEMPLATE_EDITED, edited);
  }
}

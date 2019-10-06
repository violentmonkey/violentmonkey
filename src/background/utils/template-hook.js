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

// When updating from an old version, set the edited flag retroactively
// TODO: remove this in 2020 as the majority of users will have an updated VM
global.addEventListener('backgroundInitialized', () => {
  if (getOption(SCRIPT_TEMPLATE_EDITED) == null) {
    if (getOption(SCRIPT_TEMPLATE) === INITIAL_TEMPLATE) {
      resetScriptTemplate();
    } else {
      setOption(SCRIPT_TEMPLATE_EDITED, true);
    }
  }
}, { once: true });

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

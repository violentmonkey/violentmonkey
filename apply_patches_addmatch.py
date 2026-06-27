#!/usr/bin/env python3
"""
Patches for the "Add domain to @match" feature set (popup + dashboard + comma/
shorthand expansion on save). Run from the repo root of a clean checkout of
upstream Violentmonkey (the same baseline these patches were diffed against).

Usage:
    python3 apply_patches_addmatch.py [repo_root]

Merge the PATCHES/NEW_FILES lists below into your existing apply_patches.py
(e.g. as patches 11+) if you keep all fork patches in one file.
"""
import sys
from pathlib import Path

# Each patch: (file, old, new). `old` must appear EXACTLY once in `file`.
PATCHES = [
    (
        'src/common/ui/index.js',
        r"""import { createApp, h } from 'vue';""",
        r"""import { createApp, h, reactive } from 'vue';""",
    ),
    (
        'src/common/ui/index.js',
        r"""export function showMessage(message) {
  const modal = Modal.show(() => h(Message, {""",
        r"""export function showMessage(message) {
  message = reactive(message);
  const modal = Modal.show(() => h(Message, {""",
    ),
    (
        'src/common/ui/message.vue',
        r"""    const onButtonClick = onClick => {
      if (onClick) {
        if (onClick(props.message.input) !== false) dismiss();
      }
    };""",
        r"""    const onButtonClick = async onClick => {
      if (onClick) {
        if ((await onClick(props.message.input)) !== false) dismiss();
      }
    };""",
    ),
    (
        'src/background/utils/script.js',
        r"""function checkMetaItemErrors(parts, index, errors) {""",
        r"""/** Standard alignment used by our default script template, e.g. `// @match       `. */
const MATCH_LINE_RE = /^([^\n]*?\/\/[\x20\t]*@match\b[\x20\t]*)(.+)$/;
const MATCH_LINE_PREFIX = '// @match        ';

/**
 * Completes a bare domain/host into a full `@match` pattern, e.g.
 * `example.com` -> `*://example.com/*`, `*.example.com` -> `*://*.example.com/*`.
 * Already-complete patterns (containing `://` and a path) are returned unchanged.
 * @param {string} raw
 * @return {string} empty string if `raw` is empty/whitespace
 */
export function wrapMatchPattern(raw) {
  let p = (raw || '').trim();
  if (!p) return '';
  if (!/:\/\//.test(p)) p = `*://${p}`;
  const after = p.slice(p.indexOf('://') + 3);
  if (!after.includes('/')) p += '/*';
  return p;
}

/**
 * Expands shorthand `@match` directives at save time so mobile users can type
 * `// @match example.com,xyz.*` instead of fiddling with `*://.../*` boilerplate.
 * - splits comma-separated values into one `@match` line per pattern
 * - completes each piece via `wrapMatchPattern`
 * - leaves already-valid single-pattern lines untouched (no-op, preserves formatting)
 * Only affects `@match`; not used by the programmatic "add domain" features,
 * which already write a single fully-qualified pattern per call.
 * @param {string} code
 * @return {string}
 */
export function expandMatchShorthand(code) {
  const meta = matchUserScript(code);
  if (!meta) return code;
  const body = meta[4];
  const bodyStart = meta.index + meta[1].length;
  let changed = false;
  const outLines = body.split('\n').map(line => {
    const m = MATCH_LINE_RE.exec(line);
    if (!m) return line;
    const prefix = m[1];
    const pieces = m[2].split(',').map(s => s.trim()).filter(Boolean);
    if (!pieces.length) return line;
    const wrapped = pieces.map(wrapMatchPattern);
    if (wrapped.length === 1 && wrapped[0] === pieces[0]) return line;
    changed = true;
    return wrapped.map(w => prefix + w).join('\n');
  });
  if (!changed) return code;
  const newBody = outLines.join('\n');
  return code.slice(0, bodyStart) + newBody + code.slice(bodyStart + body.length);
}

/**
 * Inserts a new `@match` line (right after the last existing one) into a script's code.
 * Skips the insertion if an identical pattern already exists.
 * @param {string} code
 * @param {string} pattern - already-complete, e.g. from `wrapMatchPattern`
 * @return {{ code: string, added: boolean, duplicate: boolean }}
 */
export function insertMatchLine(code, pattern) {
  const meta = matchUserScript(code);
  if (!meta || !pattern) return { code, added: false, duplicate: false };
  const body = meta[4];
  const bodyStart = meta.index + meta[1].length;
  const lineRe = /^[^\n]*?\/\/[\x20\t]*@match\b[\x20\t]*(.+)$/;
  const lines = body.split('\n');
  let lastIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lineRe.exec(lines[i]);
    if (m) {
      if (m[1].trim() === pattern) return { code, added: false, duplicate: true };
      lastIdx = i;
    }
  }
  const newLine = MATCH_LINE_PREFIX + pattern;
  if (lastIdx < 0) {
    lines.unshift(newLine, '');
  } else {
    lines.splice(lastIdx + 1, 0, newLine);
  }
  const newBody = lines.join('\n');
  return {
    code: code.slice(0, bodyStart) + newBody + code.slice(bodyStart + body.length),
    added: true,
    duplicate: false,
  };
}

function checkMetaItemErrors(parts, index, errors) {""",
    ),
    (
        'src/background/utils/db.js',
        r"""import {
  aliveScripts, getDefaultCustom, getNameURI, inferScriptProps, newScript, parseMeta,
  removedScripts, scriptMap,
} from './script';""",
        r"""import {
  aliveScripts, expandMatchShorthand, getDefaultCustom, getNameURI, inferScriptProps,
  insertMatchLine, newScript, parseMeta, removedScripts, scriptMap, wrapMatchPattern,
} from './script';""",
    ),
    (
        'src/background/utils/db.js',
        r"""  /** @return {Promise<string>} */
  GetScriptCode(id) {
    return storage[S_CODE][Array.isArray(id) ? 'getMulti' : 'getOne'](id);
  },""",
        r"""  /**
   * Adds a single fully-qualified `@match` pattern to a script's code, right after
   * its last existing `@match` line. Used by the popup "+" button and the dashboard's
   * domain-add box. `pattern` may be a bare domain; it's completed via `wrapMatchPattern`.
   * @return {Promise<{ duplicate: boolean, pattern: string } | (ReturnType<typeof parseScript> & { pattern: string })>}
   */
  async AddScriptMatch({ id, pattern }) {
    const wrapped = wrapMatchPattern(pattern);
    if (!wrapped) throw i18n('msgInvalidScript');
    const code = await storage[S_CODE].getOne(id);
    const result = insertMatchLine(code, wrapped);
    if (!result.added) return { duplicate: result.duplicate, pattern: wrapped };
    const res = await parseScript({
      id,
      code: result.code,
      bumpDate: true,
      message: i18n('msgMatchAdded', wrapped),
    });
    res.pattern = wrapped;
    return res;
  },
  /** @return {Promise<string>} */
  GetScriptCode(id) {
    return storage[S_CODE][Array.isArray(id) ? 'getMulti' : 'getOne'](id);
  },""",
    ),
    (
        'src/background/utils/db.js',
        r"""export async function parseScript(src) {
  const { meta, errors } = src.meta ? src : parseMetaWithErrors(src);""",
        r"""export async function parseScript(src) {
  if (src.code != null && !src.meta) {
    src.code = expandMatchShorthand(src.code);
  }
  const { meta, errors } = src.meta ? src : parseMetaWithErrors(src);""",
    ),
    (
        'src/background/utils/tabs.js',
        r"""import { getDomain } from '@/common/tld';""",
        r"""import { getDomain, getPublicSuffix } from '@/common/tld';""",
    ),
    (
        'src/background/utils/tabs.js',
        r"""addOwnCommands({
  GetTabDomain(url) {
    const host = url && new URL(url).hostname;
    return {
      host,
      domain: host && getDomain(host) || host,
    };
  },""",
        r"""addOwnCommands({
  GetTabDomain(url) {
    const host = url && new URL(url).hostname;
    const domain = host && getDomain(host) || host;
    const suffix = host && getPublicSuffix(host);
    const anyTld = domain && suffix && domain.endsWith(`.${suffix}`)
      ? `${domain.slice(0, -(suffix.length + 1))}.*`
      : domain && `${domain}.*`;
    return {
      host,
      domain,
      anyTld,
    };
  },""",
    ),
    (
        'src/background/utils/popup-tracker.js',
        r"""/** @type {{[tabId: string]: chrome.runtime.Port}} */
export const popupTabs = {};
const getCacheKey = tabId => 'SetPopup' + tabId;

addOwnCommands({
  async InitPopup() {
    const tab = await getActiveTab() || {};
    const { url = '', id: tabId } = tab;
    const data = commands.GetTabDomain(url);""",
        r"""/** @type {{[tabId: string]: chrome.runtime.Port}} */
export const popupTabs = {};
const getCacheKey = tabId => 'SetPopup' + tabId;
/** Cached host/domain of the last tab a popup was opened for, used by the dashboard's
 * "Current tab" button since it has no direct access to the tab the popup was opened on. */
let lastPopupDomain = null;

addOwnCommands({
  /** @return {{host: string, domain: string} | null} */
  GetLastPopupDomain: () => lastPopupDomain,
  async InitPopup() {
    const tab = await getActiveTab() || {};
    const { url = '', id: tabId } = tab;
    const data = commands.GetTabDomain(url);
    if (data.host) lastPopupDomain = { host: data.host, domain: data.domain, anyTld: data.anyTld };""",
    ),
    (
        'src/popup/style.css',
        r""".excludes-menu {
  padding: .25rem .5rem .25rem $leftPaneWidth;""",
        r""".excludes-menu,
.add-match-menu {
  padding: .25rem .5rem .25rem $leftPaneWidth;""",
    ),
    (
        'src/popup/views/app.vue',
        r"""            'extras-shown': extras === item,
            'excludes-shown': item.excludes,
          }""",
        r"""            'extras-shown': extras === item,
            'excludes-shown': item.excludes,
            'add-match-shown': item.addMatch,
          }""",
    ),
    (
        'src/popup/views/app.vue',
        r"""            <div class="submenu-button" :tabIndex @click="onEditScript(item)"
                 :title="i18n('buttonEditClickHint')">
              <icon name="code"></icon>
            </div>
            <div
              class="submenu-button"
              :tabIndex
              :_item.prop="item"
              @click="showExtras">
              <icon name="more"/>
            </div>
          </div>""",
        r"""            <div class="submenu-button" :tabIndex @click="onEditScript(item)"
                 :title="i18n('buttonEditClickHint')">
              <icon name="code"></icon>
            </div>
            <div class="submenu-button" :tabIndex @click="onAddMatch(item, $event)"
                 :title="i18n('menuAddMatch')">
              <icon name="plus"></icon>
            </div>
            <div
              class="submenu-button"
              :tabIndex
              :_item.prop="item"
              @click="showExtras">
              <icon name="more"/>
            </div>
          </div>""",
    ),
    (
        'src/popup/views/app.vue',
        r"""            <details class="mb-1">
              <summary><icon name="info"/></summary>
              <small>{{i18n('menuExcludeHint')}} {{i18n('labelRelated')}}<a
                v-text="i18n('labelExcludeMatch')" target="_blank"
                :href="VM_DOCS_MATCHING"/>
              </small>
            </details>
          </div>
          <div class="submenu-commands">""",
        r"""            <details class="mb-1">
              <summary><icon name="info"/></summary>
              <small>{{i18n('menuExcludeHint')}} {{i18n('labelRelated')}}<a
                v-text="i18n('labelExcludeMatch')" target="_blank"
                :href="VM_DOCS_MATCHING"/>
              </small>
            </details>
          </div>
          <div v-if="item.addMatch" class="add-match-menu mb-1c mr-1c">
            <button v-for="(val, key) in item.addMatch[1]" :key
                    v-text="val" class="ellipsis" :title="val"
                    @click="onAddMatchSave(item, val)"/>
            <input v-model="item.addMatch[0]" spellcheck="false"
                   placeholder="example.com"
                   @keypress.enter="onAddMatchSave(item)"
                   @keydown.esc.exact.stop.prevent="onAddMatchClose(item)"/>
            <button v-text="i18n('buttonOK')" @click="onAddMatchSave(item)"/>
            <button v-text="i18n('buttonClear')" @click="onAddMatchClear(item)"/>
            <button v-text="i18n('buttonCancel')" @click="onAddMatchClose(item)"/>
            <details class="mb-1">
              <summary><icon name="info"/></summary>
              <small v-text="i18n('menuAddMatchHint')"/>
            </details>
          </div>
          <div class="submenu-commands">""",
    ),
    (
        'src/popup/views/app.vue',
        r"""function onExcludeClose(item) {
  item.excludes = null;
  focus(item);
}""",
        r"""function onExcludeClose(item) {
  item.excludes = null;
  focus(item);
}
async function onAddMatch(item, evt) {
  item.el = evt.currentTarget.closest(SCRIPT_CLS) || item.el;
  const url = item.pageUrl;
  const { domain, anyTld } = await sendCmdDirectly('GetTabDomain', url);
  item.addMatch = [
    domain || '',
    domain ? { domain, sub: `*.${domain}`, tld: anyTld } : {},
  ];
  await makePause(); // $nextTick runs too early
  item.el.querySelector('.add-match-menu input').focus();
}
function onAddMatchClose(item) {
  item.addMatch = null;
  focus(item);
}
function onAddMatchClear(item) {
  item.addMatch[0] = '';
  const input = item.el?.querySelector('.add-match-menu input');
  if (input) {
    input.value = '';
    input.focus();
  }
}
async function onAddMatchSave(item, btn) {
  const pattern = btn || item.addMatch[0].trim();
  if (!pattern) return;
  const res = await sendCmdDirectly('AddScriptMatch', { id: item.props.id, pattern });
  if (res.duplicate) note.value = i18n('msgMatchExists');
  onAddMatchClose(item);
  checkReload();
}""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""      hotkeys: focused && showHotkeys,
    }""",
        r"""      hotkeys: focused && showHotkeys,
      'has-add-match': addMatchOpen,
    }""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""          <tooltip
            :disabled="!canUpdate || script.checking"
            :content="i18n('updateScript') + ' | ' + i18nUpdateScriptForced"
            :title="!canUpdate && canUpdateDeps ? i18nUpdateScriptForced : null"
            v-on="{ contextmenu: (canUpdate || canUpdateDeps) && !script.checking && onUpdate }"
            align="start">
            <a
              class="btn-ghost"
              @click="onUpdate"
              :data-hotkey="hotkeys.update"
              :tabIndex="canUpdate ? tabIndex : -1">
              <icon name="refresh" :invert.attr="canUpdate === -1 ? '' : null" />
            </a>
          </tooltip>
        </template>""",
        r"""          <tooltip
            :disabled="!canUpdate || script.checking"
            :content="i18n('updateScript') + ' | ' + i18nUpdateScriptForced"
            :title="!canUpdate && canUpdateDeps ? i18nUpdateScriptForced : null"
            v-on="{ contextmenu: (canUpdate || canUpdateDeps) && !script.checking && onUpdate }"
            align="start">
            <a
              class="btn-ghost"
              @click="onUpdate"
              :data-hotkey="hotkeys.update"
              :tabIndex="canUpdate ? tabIndex : -1">
              <icon name="refresh" :invert.attr="canUpdate === -1 ? '' : null" />
            </a>
          </tooltip>
          <tooltip :content="i18n('menuAddMatch')" :disabled="addMatchOpen" align="start">
            <a class="btn-ghost" :tabIndex @click="onAddMatchToggle">
              <icon name="plus"></icon>
            </a>
          </tooltip>
        </template>""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""        </tooltip>
      </template>
    </div>
  </div>
</template>""",
        r"""        </tooltip>
      </template>
    </div>
    <div v-if="addMatchOpen" class="add-match-panel">
      <div class="add-match-chips" v-if="tabInfo.domain">
        <button v-for="(val, key) in tabInfo.chips" :key
                v-text="val" class="ellipsis" :title="val"
                @click="onAddMatchSave(val)"/>
      </div>
      <input v-model="matchInput" spellcheck="false"
             placeholder="example.com"
             @keypress.enter="onAddMatchSave()"
             @keydown.esc.exact.stop.prevent="addMatchOpen = false"/>
      <div class="add-match-buttons">
        <button v-text="i18n('buttonCurrentTab')" @click="onAddMatchCurrentTab"/>
        <button v-text="i18n('buttonOK')" @click="onAddMatchSave()"/>
        <button v-text="i18n('buttonClear')" @click="matchInput = ''; matchNote = ''"/>
        <button v-text="i18n('buttonCancel')" @click="addMatchOpen = false"/>
      </div>
      <details class="mb-1">
        <summary><icon name="info"/></summary>
        <small v-text="matchNote || i18n('menuAddMatchHint')" :class="{ note: matchNote }"/>
      </details>
    </div>
  </div>
</template>""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""import { formatTime, getLocaleString, getScriptHome, getScriptSupportUrl, i18n } from '@/common';""",
        r"""import { formatTime, getLocaleString, getScriptHome, getScriptSupportUrl, i18n, sendCmdDirectly } from '@/common';""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""import { EXTERNAL_LINK_PROPS, getActiveElement, showConfirmation } from '@/common/ui';""",
        r"""import { EXTERNAL_LINK_PROPS, getActiveElement, showConfirmation, showMessage } from '@/common/ui';""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""import { computed, ref, watch } from 'vue';""",
        r"""import { computed, reactive, ref, watch } from 'vue';""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""const onToggle = () => emitScript('toggle');
const onUpdate = async evt => {""",
        r"""const onToggle = () => emitScript('toggle');
const addMatchOpen = ref(false);
const matchInput = ref('');
const matchNote = ref('');
const tabInfo = ref({});
async function onAddMatchToggle() {
  if (props.viewTable) {
    onAddMatchModal();
    return;
  }
  addMatchOpen.value = !addMatchOpen.value;
  if (addMatchOpen.value) {
    matchInput.value = '';
    matchNote.value = '';
    const res = await sendCmdDirectly('GetLastPopupDomain');
    tabInfo.value = res?.domain ? {
      domain: res.domain,
      chips: { domain: res.domain, sub: `*.${res.domain}`, tld: res.anyTld },
    } : {};
  }
}
async function onAddMatchModal() {
  const id = props.script.props.id;
  const initial = await sendCmdDirectly('GetLastPopupDomain');
  const message = reactive({
    text: `${cache.value.name}\n\n${i18n('menuAddMatchModal')}`,
    input: initial?.domain || '',
    buttons: [
      {
        text: i18n('buttonCurrentTab'),
        async onClick() {
          const res = await sendCmdDirectly('GetLastPopupDomain');
          message.input = res?.domain || '';
          return false;
        },
      },
      {
        text: i18n('buttonOK'),
        async onClick(val) {
          const pattern = (val || '').trim();
          if (!pattern) return false;
          const res = await sendCmdDirectly('AddScriptMatch', { id, pattern });
          if (res.duplicate) {
            showMessage({ text: i18n('msgMatchExists') });
            return false;
          }
          return true;
        },
      },
      {
        text: i18n('buttonClear'),
        onClick() {
          message.input = '';
          return false;
        },
      },
      { text: i18n('buttonCancel'), onClick: () => true },
    ],
  });
  showMessage(message);
}
const onAddMatchCurrentTab = () => {
  if (tabInfo.value.domain) matchInput.value = tabInfo.value.domain;
  matchNote.value = '';
};
const onAddMatchSave = async btn => {
  const pattern = (typeof btn === 'string' ? btn : matchInput.value).trim();
  if (!pattern) return;
  const res = await sendCmdDirectly('AddScriptMatch', { id: props.script.props.id, pattern });
  if (res.duplicate) {
    matchNote.value = i18n('msgMatchExists');
  } else {
    addMatchOpen.value = false;
  }
};
const onUpdate = async evt => {""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""  background: var(--bg);
  width: calc((100% - $itemMargin) / var(--num-columns) - $itemMargin);
  height: $itemHeight;
  &:hover {""",
        r"""  background: var(--bg);
  width: calc((100% - $itemMargin) / var(--num-columns) - $itemMargin);
  height: $itemHeight;
  &.has-add-match {
    height: auto;
  }
  &:hover {""",
    ),
    (
        'src/options/views/script-item.vue',
        r"""svg[invert] {
  fill: transparent;
  stroke: currentColor;
  stroke-width: $strokeWidth;
}
</style>""",
        r"""svg[invert] {
  fill: transparent;
  stroke: currentColor;
  stroke-width: $strokeWidth;
}
.add-match-panel {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: .4rem;
  margin-top: .5rem;
  padding-top: .5rem;
  border-top: 1px solid var(--fill-3);
  input {
    width: 100%;
  }
  .add-match-chips,
  .add-match-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: .4rem;
    button {
      max-width: 100%;
    }
  }
  small {
    color: var(--fill-7);
    &.note {
      color: red;
    }
  }
}
</style>""",
    ),
    (
        'src/options/views/edit/index.vue',
        r"""    const id = scr.props.id;
    const res = await sendCmdDirectly('ParseScript', {
      id,
      code: $codeComp.getRealContent(),""",
        r"""    const id = scr.props.id;
    const codeSent = $codeComp.getRealContent();
    const res = await sendCmdDirectly('ParseScript', {
      id,
      code: codeSent,""",
    ),
    (
        'src/options/views/edit/index.vue',
        r"""    const newId = res.where.id;
    const newScript = res.update;
    CM.markClean();""",
        r"""    const newId = res.where.id;
    const newScript = res.update;
    if (res.code != null && res.code !== codeSent) {
      // backend expanded shorthand `@match` lines (commas/bare domains); reflect it in the editor
      CM.operation(() => { CM.setValue(res.code); CM.clearHistory(); });
    }
    CM.markClean();""",
    ),
    (
        '_locales/en/messages.yml',
        r"""buttonClose:
  description: Button to close window.
  message: Close""",
        r"""buttonClear:
  description: Button to clear the domain input box.
  message: Clear
buttonClose:
  description: Button to close window.
  message: Close""",
    ),
    (
        '_locales/en/messages.yml',
        r"""buttonDisable:
  description: Button to disable a script.
  message: Disable""",
        r"""buttonCurrentTab:
  description: Button to fill the domain input with the current/last-viewed tab's domain.
  message: Current tab
buttonDisable:
  description: Button to disable a script.
  message: Disable""",
    ),
    (
        '_locales/en/messages.yml',
        r"""menuCommands:
  description: Menu item to list script commands.
  message: Script commands""",
        r"""menuAddMatch:
  description: Button/tooltip to add a domain to a script's @match lines.
  message: Add domain to @match
menuAddMatchHint:
  description: Hint shown under the add-domain box.
  message: >-
    Paste or type a bare domain (e.g. example.com or *.example.com) - it will
    be completed into a full @match line automatically.
menuCommands:
  description: Menu item to list script commands.
  message: Script commands""",
    ),
    (
        '_locales/en/messages.yml',
        r"""menuAddMatch:
  description: Button/tooltip to add a domain to a script's @match lines.
  message: Add domain to @match
menuAddMatchHint:""",
        r"""menuAddMatch:
  description: Button/tooltip to add a domain to a script's @match lines.
  message: Add domain to @match
menuAddMatchModal:
  description: Description line shown in the table-view "add domain" modal, under the script name.
  message: Add a domain to @match...
menuAddMatchHint:""",
    ),
    (
        '_locales/en/messages.yml',
        r"""msgMissingResources:""",
        r"""msgMatchExists:
  description: Shown when the @match pattern being added already exists in the script.
  message: That pattern is already in @match.
msgMissingResources:""",
    ),
    (
        '_locales/en/messages.yml',
        r"""msgMatchExists:""",
        r"""msgMatchAdded:
  description: Shown after a new @match pattern is successfully added. $1 is the pattern.
  message: Added $1 to @match.
msgMatchExists:""",
    ),
]

# New file written verbatim (jest tests for the pure helper functions).
NEW_FILES = {
    'test/background/add-match.test.js': r"""import {
  expandMatchShorthand, insertMatchLine, parseMeta, wrapMatchPattern,
} from '@/background/utils/script';

test('wrapMatchPattern', () => {
  expect(wrapMatchPattern('example.com')).toBe('*://example.com/*');
  expect(wrapMatchPattern('*.example.com')).toBe('*://*.example.com/*');
  expect(wrapMatchPattern('xyz.*')).toBe('*://xyz.*/*');
  expect(wrapMatchPattern('https://example.com')).toBe('https://example.com/*');
  expect(wrapMatchPattern('*://example.com/*')).toBe('*://example.com/*');
  expect(wrapMatchPattern('example.com/path/*')).toBe('*://example.com/path/*');
  expect(wrapMatchPattern('  ')).toBe('');
  expect(wrapMatchPattern('')).toBe('');
});

test('expandMatchShorthand: comma list + bare domains get expanded', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match       example.com,xyz.*
// @grant       none
// ==/UserScript==
// body
`;
  const out = expandMatchShorthand(code);
  expect(out).toContain('// @match       *://example.com/*\n// @match       *://xyz.*/*');
  expect(out).toContain('// body\n');
  expect(parseMeta(out).match).toEqual(['*://example.com/*', '*://xyz.*/*']);
});

test('expandMatchShorthand: already-valid single pattern is left untouched (no-op)', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match        *://example.com/*
// @grant       none
// ==/UserScript==
`;
  expect(expandMatchShorthand(code)).toBe(code);
});

test('expandMatchShorthand: no metablock is a no-op', () => {
  expect(expandMatchShorthand('plain text')).toBe('plain text');
});

test('insertMatchLine: appends after the last @match line', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match       *://a.com/*
// @match       *://b.com/*
// @grant       none
// ==/UserScript==
`;
  const res = insertMatchLine(code, '*://c.com/*');
  expect(res.added).toBe(true);
  expect(res.duplicate).toBe(false);
  const lines = res.code.split('\n');
  const bIdx = lines.findIndex(l => l.includes('b.com'));
  expect(lines[bIdx + 1]).toContain('c.com');
  expect(parseMeta(res.code).match).toEqual(['*://a.com/*', '*://b.com/*', '*://c.com/*']);
});

test('insertMatchLine: detects duplicates and is a no-op', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @match       *://a.com/*
// @grant       none
// ==/UserScript==
`;
  const res = insertMatchLine(code, '*://a.com/*');
  expect(res.added).toBe(false);
  expect(res.duplicate).toBe(true);
  expect(res.code).toBe(code);
});

test('insertMatchLine: works when there is no existing @match line', () => {
  const code = `\
// ==UserScript==
// @name        Test
// @grant       none
// ==/UserScript==
`;
  const res = insertMatchLine(code, '*://a.com/*');
  expect(res.added).toBe(true);
  expect(parseMeta(res.code).match).toEqual(['*://a.com/*']);
});
""",
}


def apply_patches(root: Path):
    for i, (rel, old, new) in enumerate(PATCHES, 1):
        path = root / rel
        text = path.read_text(encoding='utf-8')
        count = text.count(old)
        if count != 1:
            sys.exit(f'[patch {i}] FAILED: anchor found {count}x (expected 1) in {rel}\n--- anchor ---\n{old}')
        path.write_text(text.replace(old, new), encoding='utf-8')
        print(f'[patch {i}] OK: {rel}')
    for rel, content in NEW_FILES.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        print(f'[new file] OK: {rel}')


if __name__ == '__main__':
    apply_patches(Path(sys.argv[1] if len(sys.argv) > 1 else '.'))

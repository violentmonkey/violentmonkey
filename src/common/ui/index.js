import { createApp, h } from 'vue';
import Modal from 'vueleton/lib/modal';
import { trueJoin } from '@/common';
import { i18n } from '@/common/util';
import Message from './message';
import { VM_HOME } from '@/common/consts';

/** Showing unexpected errors in UI so that the users can notify us */
addEventListener('error', e => showUnhandledError(e.error));
addEventListener('unhandledrejection', e => showUnhandledError(e.reason));
function showUnhandledError(err) {
  if (!err) return;
  const id = 'unhandledError';
  const fontSize = 10;
  const el = document.getElementById(id) || document.createElement('textarea');
  const text = el.value = [
    el.value,
    isObject(err)
      ? `${IS_FIREFOX && err.message || ''}\n${err.stack || ''}`
      : `${err}`,
  ]::trueJoin('\n\n').trim().split(extensionRoot).join('');
  const height = fontSize * (calcRows(text) + 1) + 'px';
  const parent = document.body || document.documentElement;
  el.id = id;
  el.readOnly = true;
  // using an inline style because we don't know if our CSS is loaded at this stage
  el.style.cssText = `\
    position:fixed;
    z-index:${1e9};
    left:0;
    right:0;
    bottom:0;
    background:#000;
    color:red;
    padding: ${fontSize / 2}px;
    font-size: ${fontSize}px;
    line-height: 1;
    box-sizing: border-box;
    height: ${height};
    border: none;
    resize: none;
  `.replace(/;/g, '!important;');
  el.spellcheck = false;
  el.onclick = () => el.select();
  parent.style.minHeight = height;
  parent.appendChild(el);
}

export function showMessage(message) {
  const modal = Modal.show(() => h(Message, {
    message,
    onDismiss() {
      modal.close();
      message.onDismiss?.();
    },
  }), {
    transition: 'in-out',
  });
  if (!message.buttons) {
    const timer = setInterval(() => {
      if (!document.querySelector('.vl-modal .modal-content:hover')) {
        clearInterval(timer);
        modal.close();
      }
    }, message.timeout || 2000);
  }
}

/**
 * @param {string} text - the text to display in the modal
 * @param {Object} cfg
 * @param {string | false} [cfg.input=false] if not false, shows a text input with this string
 * @param {?Object|false} [cfg.ok] additional props for the Ok button or `false` to remove it
 * @param {?Object|false} [cfg.cancel] same for the Cancel button
 * @return {Promise<?string|boolean>}
 *   `input` is false: <boolean> i.e. true on Ok, false otherwise;
 *   `input` is string: <?string> i.e. string on Ok, null otherwise;
 */
export function showConfirmation(text, { ok, cancel, input = false } = {}) {
  return new Promise(resolve => {
    const hasInput = input !== false;
    const onCancel = () => resolve(hasInput ? null : false);
    const onOk = val => resolve(!hasInput || val);
    showMessage({
      input,
      text,
      buttons: [
        ok !== false && { text: i18n('buttonOK'), onClick: onOk, ...ok },
        cancel !== false && { text: i18n('buttonCancel'), onClick: onCancel, ...cancel },
      ].filter(Boolean),
      onBackdropClick: onCancel,
      onDismiss: onCancel, // Esc key
    });
  });
}

/** @returns {?number} Number of lines + 1 if the last line is not empty */
export function calcRows(val) {
  return val && (
    val.match(/$/gm).length
      + !val.endsWith('\n')
  );
}

export function render(App, el) {
  const app = createApp(App);
  Object.assign(app.config.globalProperties, {
    i18n,
    calcRows,
  });
  if (!el) {
    el = document.createElement('div');
    document.body.append(el);
  }
  app.mount(el);
  return app;
}

/**
 * Focuses the first element with `focusme` attribute or root, which enables keyboard scrolling.
 * Not using `autofocus` to avoid warnings in console on page load.
 * A child component should use nextTick to change focus, which runs later.
 */
export function focusMe(el) {
  el = el.querySelector('[focusme]') || el;
  el.tabIndex = -1;
  el.focus();
}

function vFocusFactory() {
  const handle = (el, value, oldValue) => {
    if (value === oldValue) return;
    if (value == null || value) {
      el.tabIndex = -1;
      el.focus();
    }
  };
  return {
    mounted(el, binding) {
      handle(el, binding.value, {});
    },
    updated(el, binding) {
      handle(el, binding.value, binding.oldValue);
    },
  };
}
/**
 * Usage:
 *
 * ```html
 * <!-- Focus on mounted -->
 * <div v-focus>...</div>
 *
 * <!-- Focus whenever `value` becomes truthy -->
 * <div v-focus="value">...</div>
 * ```
 */
export const vFocus = vFocusFactory();
export const isTouch = 'ontouchstart' in document;
export const getActiveElement = () => document.activeElement;
/** @param {MouseEvent|KeyboardEvent} e */
export const hasKeyModifiers = e => e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
export const externalEditorInfoUrl =
  VM_HOME + 'posts/how-to-edit-scripts-with-your-favorite-editor/';
export const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
};
const { getAsFileSystemHandle } = DataTransferItem.prototype;

if (getAsFileSystemHandle) {
  const { find } = [];
  /**
   * @param {DragEvent} evt
   * @return {?DataTransferItem}
   */
  const getItem = evt => evt.dataTransfer.items::find(v => v.type === 'text/javascript');
  addEventListener('dragover', evt => {
    if (getItem(evt)) evt.preventDefault();
  }, true);
  addEventListener('drop', async evt => {
    const item = getItem(evt);
    if (!item) return;
    evt.preventDefault();
    evt.stopPropagation();
    const path = '/confirm/index.html';
    // Some apps provide the file's URL in a text dataTransfer item.
    const url = evt.dataTransfer.getData('text');
    const handle = await item::getAsFileSystemHandle();
    const isNewWindow = hasKeyModifiers(evt) || location.pathname !== path;
    const wnd = isNewWindow ? window.open(path) : window;
    // Transfer the handle to the new window (required in some versions of Chrome)
    const structuredClone = isNewWindow && wnd.structuredClone; // Chrome 98+
    (wnd.fsh = structuredClone ? structuredClone(handle) : handle)._url = url;
  }, true);
}

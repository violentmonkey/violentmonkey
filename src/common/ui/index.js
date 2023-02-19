import { createApp, h, nextTick } from 'vue';
import Modal from 'vueleton/lib/modal';
import { i18n } from '@/common/util';
import Message from './message';

/** Showing unexpected errors in UI so that the users can notify us */
addEventListener('error', e => showUnhandledError(e.error));
addEventListener('unhandledrejection', e => showUnhandledError(e.reason));
function showUnhandledError(err) {
  if (!err) return;
  const el = document.createElement('pre');
  // using an inline style because we don't know if our CSS is loaded at this stage
  el.style.cssText = `\
    position:fixed;
    z-index:${1e9};
    left:0;
    right:0;
    bottom:0;
    background:#000;
    color:red;
    padding: 1em;
  `.replace(/;/g, '!important;');
  el.textContent = `${IS_FIREFOX && err.message || ''}\n${err.stack || ''}`.trim() || err;
  el.onclick = () => getSelection().setBaseAndExtent(el, 0, el, 1);
  (document.body || document.documentElement).appendChild(el);
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
  if (message.buttons) {
    // TODO: implement proper keyboard navigation, autofocus, and Enter/Esc in Modal module
    document.querySelector('.vl-modal button').focus();
  } else {
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
  nextTick(() => {
    el = el.querySelector('[focusme]') || el;
    el.tabIndex = -1;
    el.focus();
  });
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

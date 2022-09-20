import { createApp, h } from 'vue';
import Modal from 'vueleton/lib/modal';
import { i18n } from '@/common/util';
import Message from './message';

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
 * @return {Promise<?string>} resolves on Ok to `false` or the entered string, rejects otherwise
 */
export function showConfirmation(text, { ok, cancel, input = false } = {}) {
  return new Promise((resolve, reject) => {
    showMessage({
      input,
      text,
      buttons: [
        ok !== false && { text: i18n('buttonOK'), onClick: resolve, ...ok },
        cancel !== false && { text: i18n('buttonCancel'), onClick: reject, ...cancel },
      ].filter(Boolean),
      onBackdropClick: reject,
      onDismiss: reject, // Esc key
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

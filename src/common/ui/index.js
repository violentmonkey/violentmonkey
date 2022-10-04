import Modal from 'vueleton/lib/modal/bundle';
import { i18n } from '@/common/util';
import Message from './message';

export function showMessage(message) {
  const modal = Modal.show(h => h(Message, {
    props: { message },
    on: {
      dismiss() {
        modal.close();
        message.onDismiss?.();
      },
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
 * @return {Promise<?string|true>} resolves on Ok to `true` or the entered string, null otherwise
 */
export function showConfirmation(text, { ok, cancel, input = false } = {}) {
  return new Promise(resolve => {
    const onCancel = () => resolve(null);
    const onOk = val => resolve(input === false || val);
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

/** Focus the first tabindex=-1 element or root, to enable scrolling via Home/End/PgUp/PgDn */
export function focusMe() {
  setTimeout(() => {
    const el = this.$el;
    (el.querySelector('[tabindex="-1"]') || (el.tabIndex = -1, el)).focus();
  });
}

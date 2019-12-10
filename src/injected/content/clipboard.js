import { sendCmd } from '../utils';
import { addEventListener, logging } from '../utils/helpers';
import bridge from './bridge';

// old Firefox defines it on a different prototype so we'll just grab it from document directly
const { execCommand } = document;
const { setData } = DataTransfer.prototype;
const getClipboardData = Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, 'clipboardData').get;
const { preventDefault, stopImmediatePropagation } = Event.prototype;
const { removeEventListener } = EventTarget.prototype;

let clipboardData;

bridge.addHandlers({
  SetClipboard(data) {
    if (bridge.isFirefox) {
      // Firefox does not support copy from background page.
      // ref: https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Interact_with_the_clipboard
      // The dirty way will create a <textarea> element in web page and change the selection.
      setClipboard(data);
    } else {
      sendCmd('SetClipboard', data);
    }
  },
});

function onCopy(e) {
  e::stopImmediatePropagation();
  e::preventDefault();
  const { type, data } = clipboardData;
  e::getClipboardData()::setData(type || 'text/plain', data);
}

function setClipboard({ type, data }) {
  clipboardData = { type, data };
  document::addEventListener('copy', onCopy, false);
  const ret = document::execCommand('copy', false, null);
  document::removeEventListener('copy', onCopy, false);
  clipboardData = null;
  if (process.env.DEBUG && !ret) {
    logging.warn('Copy failed!');
  }
}

import { addEventListener, warn } from '../utils/helpers';

const { execCommand } = Document.prototype;
const { setData } = DataTransfer.prototype;
const getClipboardData = Object.getOwnPropertyDescriptor(ClipboardEvent.prototype, 'clipboardData').get;
const { preventDefault, removeEventListener, stopImmediatePropagation } = EventTarget.prototype;

let clipboardData;

function onCopy(e) {
  e::stopImmediatePropagation();
  e::preventDefault();
  const { type, data } = clipboardData;
  e::getClipboardData::setData(type || 'text/plain', data);
}

export default function setClipboard({ type, data }) {
  clipboardData = { type, data };
  document::addEventListener('copy', onCopy, false);
  const ret = document::execCommand('copy', false, null);
  document::removeEventListener('copy', onCopy, false);
  clipboardData = null;
  if (process.env.DEBUG && !ret) {
    warn('Copy failed!');
  }
}

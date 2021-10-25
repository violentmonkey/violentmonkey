import { log } from '../utils/helpers';
import bridge from './bridge';

bridge.onScripts.push(() => {
  let setClipboard;
  if (bridge.isFirefox) {
    let clipboardData;
    // old Firefox defines it on a different prototype so we'll just grab it from document directly
    const { execCommand } = document;
    const { setData } = DataTransfer[Prototype];
    const { get: getClipboardData } = describeProperty(ClipboardEvent[Prototype], 'clipboardData');
    const { preventDefault, stopImmediatePropagation } = Event[Prototype];
    const onCopy = e => {
      e::stopImmediatePropagation();
      e::preventDefault();
      e::getClipboardData()::setData(clipboardData.type || 'text/plain', clipboardData.data);
    };
    setClipboard = params => {
      clipboardData = params;
      document::addEventListener('copy', onCopy);
      if (!document::execCommand('copy') && process.env.DEBUG) {
        log('warn', null, 'GM_setClipboard failed!');
      }
      document::removeEventListener('copy', onCopy);
      clipboardData = null;
    };
  }
  bridge.addHandlers({
    __proto__: null, // Object.create(null) may be spoofed
    SetClipboard: setClipboard || true,
  }, true);
});

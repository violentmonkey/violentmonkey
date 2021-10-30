import { log } from '../util';
import bridge from './bridge';

bridge.onScripts.push(() => {
  let setClipboard;
  if (IS_FIREFOX) {
    let clipboardData;
    // old Firefox defines it on a different prototype so we'll just grab it from document directly
    const { execCommand } = document;
    const { setData } = DataTransfer[PROTO];
    const { get: getClipboardData } = describeProperty(ClipboardEvent[PROTO], 'clipboardData');
    const { preventDefault, stopImmediatePropagation } = Event[PROTO];
    const onCopy = e => {
      e::stopImmediatePropagation();
      e::preventDefault();
      e::getClipboardData()::setData(clipboardData.type || 'text/plain', clipboardData.data);
    };
    setClipboard = params => {
      clipboardData = params;
      document::on('copy', onCopy);
      if (!document::execCommand('copy') && process.env.DEBUG) {
        log('warn', null, 'GM_setClipboard failed!');
      }
      document::off('copy', onCopy);
      clipboardData = null;
    };
  }
  bridge.addHandlers({
    SetClipboard: setClipboard || true,
  }, true);
});

import bridge, { addHandlers, onScripts } from './bridge';

export let onClipboardCopy;
let doCopy;
let clipboardData;
let setClipboard;

// Attaching a dummy listener so the page can't prevent us (fwiw h@xx0rz excluded)
if (IS_FIREFOX) {
  on('copy', onClipboardCopy = e => clipboardData && doCopy(e), true);
}

onScripts.push(({ clipFF }) => {
  if (clipFF) {
    const { execCommand } = document;
    const { setData } = DataTransfer[PROTO];
    const { get: getClipboardData } = describeProperty(ClipboardEvent[PROTO], 'clipboardData');
    const { preventDefault, stopPropagation } = Event[PROTO];
    doCopy = e => {
      e::stopPropagation();
      e::stopImmediatePropagation();
      e::preventDefault();
      e::getClipboardData()::setData(clipboardData.type || 'text/plain', clipboardData.data);
    };
    setClipboard = async params => {
      await bridge[REIFY];
      clipboardData = params;
      if (!document::execCommand('copy') && process.env.DEBUG) {
        log('warn', null, 'GM_setClipboard failed!');
      }
      clipboardData = null;
    };
  }
  addHandlers({
    SetClipboard: setClipboard || REIFY,
  });
});

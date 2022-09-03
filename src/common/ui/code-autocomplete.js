import CodeMirror from 'codemirror';

const ID = 'autocompleteOnTyping';
const DEFAULT = true;
const HINT_OPTIONS = 'hintOptions';
const COMPLETE_SINGLE = 'completeSingle';
const PICKED = 'picked';
const TIMER = 'timer';
const DELAY = 100;

// eslint-disable-next-line no-return-assign
const getMyState = ({ state }) => (state[ID] || (state[ID] = {}));

const delayedComplete = cm => {
  const { options } = cm;
  const hintOptions = options[HINT_OPTIONS] || (options[HINT_OPTIONS] = {});
  hintOptions[COMPLETE_SINGLE] = false;
  getMyState(cm)[PICKED] = false;
  cm.execCommand('autocomplete');
  setTimeout(() => {
    hintOptions[COMPLETE_SINGLE] = true;
  });
};

const cancelDelay = ({ [TIMER]: timer }) => {
  if (timer) clearTimeout(timer);
};

const onChanges = (cm, [info]) => {
  const myState = getMyState(cm);
  const lastTyped = info.text[info.text.length - 1];
  if (cm.state.completionActive
    || info.origin && !info.origin.includes('input')
    || !lastTyped) {
    return;
  }
  if (myState[PICKED]) {
    myState[PICKED] = false;
    return;
  }
  if (/[-a-z!]$/i.test(lastTyped)) {
    cancelDelay(myState);
    myState[TIMER] = setTimeout(delayedComplete, DELAY, cm);
  }
};

const onPicked = cm => {
  getMyState(cm)[PICKED] = true;
};

CodeMirror.defineOption(ID, DEFAULT, (cm, value) => {
  const myState = getMyState(cm);
  const onOff = value ? 'on' : 'off';
  cm[onOff]('changes', onChanges);
  cm[onOff]('pick', onPicked);
  if (myState && !value) {
    cancelDelay(myState);
    delete cm.state[ID];
  }
});

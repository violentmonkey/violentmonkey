const getData = describeProperty(MessageEvent[PROTO], 'data').get;
const { port1, port2 } = new MessageChannel();
const postMessage = port1.postMessage.bind(port1);
const queue = createNullObj();

let uniqId = 0;

port2.onmessage = evt => {
  const id = evt::getData();
  const cb = queue[id];
  delete queue[id];
  if (uniqId === id) uniqId -= 1;
  cb();
};

export function nextTask() {
  return new SafePromise(resolve => {
    queue[uniqId += 1] = resolve;
    postMessage(uniqId);
  });
}

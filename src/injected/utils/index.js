const getDetail = describeProperty(CustomEvent[Prototype], 'detail').get;

export function bindEvents(srcId, destId, bridge, cloneInto) {
  global::addEventListener(srcId, e => bridge.onHandle(e::getDetail()));
  bridge.post = (cmd, params, context) => {
    const data = { cmd, data: params, dataKey: (context || bridge).dataKey };
    const detail = cloneInto ? cloneInto(data, document) : data;
    const e = new CustomEvent(destId, { detail });
    global::dispatchEvent(e);
  };
}

export function bindEvents(srcId, destId, handle, cloneInto) {
  const getDetail = describeProperty(CustomEvent[Prototype], 'detail').get;
  const pageContext = cloneInto && document.defaultView;
  document::addEventListener(srcId, e => handle(e::getDetail()));
  return (cmd, params) => {
    const data = { cmd, data: params };
    const detail = cloneInto ? cloneInto(data, pageContext) : data;
    const e = new CustomEvent(destId, { detail });
    document::dispatchEvent(e);
  };
}

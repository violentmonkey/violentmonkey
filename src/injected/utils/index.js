import { addEventListener, document } from './helpers';

const { CustomEvent, dispatchEvent } = global;

export function bindEvents(srcId, destId, handle, cloneInto) {
  document::addEventListener(srcId, e => handle(e.detail));
  const pageContext = cloneInto && document.defaultView;
  return (cmd, params) => {
    const data = { cmd, data: params };
    const detail = cloneInto ? cloneInto(data, pageContext) : data;
    const e = new CustomEvent(destId, { detail });
    document::dispatchEvent(e);
  };
}

import bridge from './bridge';
import handlers from "@/common/handlers";

const eventTargets = new Map();
const eventTargetHandles = new WeakMap();

let counter = 0;

Object.assign(handlers, {
  NativeConnectionEvent(handle, event, detail) {
    const target = eventTargets.get(handle);
    if (target)
      target.dispatchEvent(new CustomEvent(event, {detail}));
  },
});

function _post(conn, msg) {
  const handle = eventTargetHandles.get(conn);
  if (handle !== undefined)
    bridge.post('NativePostMessage', {handle, msg});
}

function _disconnect(conn) {
  const handle = eventTargetHandles.get(conn);
  if (handle !== undefined)
    bridge.post('NativeDisconnect', {handle});
}

class NativeConnection extends EventTarget {
  constructor() {
    super();
    this.onDisconnect = {
      addListener: cb => this.addEventListener("disconnect", cb),
      removeListener: cb => this.removeEventListener("disconnect", cb),
    };
    this.onMessage = {
      addListener: cb => this.addEventListener("message", cb),
      removeListener: cb => this.removeEventListener("message", cb),
    };
  }

  postMessage(msg) {
    _post(this, msg);
  }

  disconnect() {
    _disconnect(this);
  }
}

export function nativeConnect(id, app) {
  if (eventTargets.size >= Number.MAX_VALUE) throw new Error("Maximum connections exceeded");
  const conn = new NativeConnection();
  if (counter >= Number.MAX_VALUE) counter = Number.MIN_VALUE;
  let handle = counter++;
  while (eventTargets.has(handle)) {
    if (counter >= Number.MAX_VALUE) counter = Number.MIN_VALUE;
    handle = counter++;
  }
  eventTargets.set(handle, conn);
  eventTargetHandles.set(conn, handle);
  bridge.post('NativeConnect', {id, app, handle});
  return conn;
}

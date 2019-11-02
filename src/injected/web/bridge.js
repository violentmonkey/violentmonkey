import { assign, noop } from '../utils/helpers';

const handlers = {};

export default {
  load: noop,
  addHandlers(obj) {
    assign(handlers, obj);
  },
  onHandle(obj) {
    const handle = handlers[obj.cmd];
    if (handle) handle(obj.data);
  },
};

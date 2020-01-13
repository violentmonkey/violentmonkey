import { assign, noop } from '../utils/helpers';

const handlers = {};

export default {
  load: noop,
  addHandlers(obj) {
    assign(handlers, obj);
  },
  onHandle({ cmd, data }) {
    handlers[cmd]?.(data);
  },
};

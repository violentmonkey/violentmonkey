import { noop } from './helpers';
import { getUniqId } from '../utils';

export default {
  id: `VM_${getUniqId()}`,
  load: noop,
  checkLoad: noop,
};

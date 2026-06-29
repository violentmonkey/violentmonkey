import setClipboard from '@/common/clipboard';
import { addPublicCommands } from './init';

addPublicCommands({
  SetClipboard: setClipboard,
});

import { sendMessage } from '../utils';
import bridge from './bridge';

export function tabOpen(data) {
  sendMessage({ cmd: 'TabOpen', data });
}
export function tabClose(id) {
  sendMessage({ cmd: 'TabClose', data: { id } });
}
export function tabClosed(id) {
  bridge.post({ cmd: 'TabClosed', data: id });
}

import Modal from 'vueleton/lib/modal';
import Message from '../views/message';

export const store = {};

export function showMessage(message) {
  const modal = Modal.show(h => h(Message, {
    props: { message },
    on: {
      dismiss() {
        modal.close();
      },
    },
  }), {
    transition: 'in-out',
  });
  if (!message.buttons) {
    setTimeout(() => {
      modal.close();
    }, 2000);
  }
}

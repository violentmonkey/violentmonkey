import Vue from 'vue';
import Message from '../views/message';

export const store = {
  messages: null,
};

function initMessage() {
  if (store.messages) return;
  store.messages = [];
  const el = document.createElement('div');
  document.body.appendChild(el);
  new Vue({
    render: h => h(Message),
  }).$mount(el);
}

let id = 0;

export function showMessage(options) {
  initMessage();
  id += 1;
  const message = Object.assign({
    id,
  }, options, !options.buttons && {
    onInit(vm) {
      setTimeout(() => {
        vm.$emit('dismiss');
      }, 2000);
    },
  });
  store.messages.push(message);
}

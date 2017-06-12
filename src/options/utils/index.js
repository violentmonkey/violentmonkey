import Vue from 'vue';
import './dropdown';
import resetFeatures from './features';
import Message from '../views/message';

export hookSetting from './settings';

export const store = {
  messages: null,
};
export const features = { reset: resetFeatures };

function initMessage() {
  if (store.messages) return;
  store.messages = [];
  const el = document.createElement('div');
  document.body.appendChild(el);
  new Vue({
    render: h => h(Message),
  }).$mount(el);
}

export function showMessage(options) {
  initMessage();
  const message = Object.assign({}, options, !options.buttons && {
    onInit(vm) {
      setTimeout(() => {
        vm.$emit('dismiss');
      }, 2000);
    },
  });
  store.messages.push(message);
}

import Vue from 'vue';
import './dropdown';
import './settings';
import resetFeatures from './features';
import Message from '../views/message';

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

export function showMessage(data) {
  initMessage();
  store.messages.push(data);
  setTimeout(() => {
    const i = store.messages.indexOf(data);
    if (i >= 0) store.messages.splice(i, 1);
  }, 2000);
}

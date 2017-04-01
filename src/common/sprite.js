import { request } from '.';

request('/public/sprite.svg')
.then(({ data }) => {
  const div = document.createElement('div');
  div.style.display = 'none';
  div.innerHTML = data;
  document.body.insertBefore(div, document.body.firstChild);
});

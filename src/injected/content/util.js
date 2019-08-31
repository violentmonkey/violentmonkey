import { getUniqId } from '#/common';

function removeElement(id) {
  const el = document.querySelector(`#${id}`);
  if (el) {
    el.parentNode.removeChild(el);
    return true;
  }
}

export function inject(code, sourceUrl) {
  const script = document.createElement('script');
  const id = getUniqId('VM-');
  script.id = id;
  const sourceComment = sourceUrl ? `\n//# sourceURL=${sourceUrl}` : '';
  script.textContent = `!${removeElement.toString()}(${JSON.stringify(id)});${code}${sourceComment}`;
  document.documentElement.appendChild(script);
  // in case the script is blocked by CSP
  removeElement(id);
}

import { route } from '#/common/router';

routeChanged();

export function routeChanged() {
  const enable = !route.pathname || route.pathname === 'scripts';
  document[`${enable ? 'add' : 'remove'}EventListener`]('keydown', onKeyDown);
}

function onKeyDown(e) {
  if (e.altKey || e.shiftKey || e.metaKey) {
    return;
  }
  const filterEl = document.querySelector('.filter-search input');
  const activeEl = document.activeElement;
  if (activeEl !== filterEl && activeEl?.matches?.('button, input, select, textarea')) {
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey || e.code === 'KeyF' && e.ctrlKey) {
    filterEl.focus();
    if (e.ctrlKey) e.preventDefault();
    return;
  }
  if (e.ctrlKey) {
    return;
  }
  let el = document.querySelector('.script.focused');
  switch (e.key) {
  case 'Enter':
    if (el) {
      e.preventDefault();
      el.dispatchEvent(new Event('keydownEnter'));
    }
    break;
  case 'ArrowUp':
  case 'ArrowDown': {
    e.preventDefault();
    const dir = e.key === 'ArrowUp' ? -1 : 1;
    const all = document.querySelectorAll('.script:not([style*="display"])');
    const numScripts = all.length;
    if (!numScripts) {
      return;
    }
    if (!el) {
      all[dir > 0 ? 0 : numScripts - 1].classList.add('focused');
      return;
    }
    el.classList.remove('focused');
    el = all[([...all].indexOf(el) + dir + numScripts) % numScripts];
    el.classList.add('focused');
    const bounds = el.getBoundingClientRect();
    const parentBounds = el.parentElement.getBoundingClientRect();
    if (bounds.top > parentBounds.bottom || bounds.bottom < parentBounds.top) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
    break;
  }
  default:
  }
}

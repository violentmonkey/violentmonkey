import ua from '#/common/ua';

const SCROLL_GAP = 50;
// px per one 60fps frame so the max is ~1200px per second (~one page)
const MAX_SCROLL_SPEED = 20;
const ONE_FRAME_MS = 16;
// touch-and-hold duration in ms before recognizing dragstart (needed to allow fling-scrolling)
const LONGPRESS_DELAY = 500;
const DROP_EVENT_RELAY = 'VM-drop-event-relay';

const isTouch = 'ontouchstart' in document;
const eventNames = isTouch
  ? { start: 'touchstart', move: 'touchmove', end: 'touchend' }
  : { start: 'dragstart', move: 'mousemove', end: 'mouseup' };
// inserting a scroll blocker as the first element of the list to avoid changing the list's
// style/class as it would be slooooooooooow due to style recalc on all of its children
const noScroll = isTouch && Object.assign(document.createElement('div'), {
  className: 'dragging-noscroll',
});
const eventsToSuppress = ['scroll', 'mouseenter', 'mouseleave'];
const { addEventListener: on, removeEventListener: off } = EventTarget.prototype;

let dragged;
let elements;
let height;
let index;
let lastIndex;
let longPressEvent;
let longPressTimer;
let offsetX;
let offsetY;
let original;
let parent;
let scrollEdgeTop;
let scrollEdgeBottom;
let scrollTimer;
let scrollSpeed;
let scrollTimestamp;
let xyCache;

/**
 * @param {Element} el
 * @param {function(from,to)} onDrop
 */
export default function enableDragging(el, { onDrop }) {
  if (!parent) {
    parent = el.parentElement;
    // pre-FF64 doesn't support `@media (pointer: coarse)`
    if (isTouch && !matchMedia('(pointer: coarse)').matches) {
      parent.classList.add('touch');
    }
  }
  el::on(eventNames.start, isTouch ? onTouchStart : onDragStart);
  el::on(DROP_EVENT_RELAY, () => onDrop(index, lastIndex));
}

function onTouchStart(e) {
  original = this;
  longPressEvent = e;
  longPressTimer = setTimeout(onTouchMoveDetect, LONGPRESS_DELAY, 'timer');
  document::on(eventNames.move, onTouchMoveDetect);
  document::on(eventNames.end, onTouchEndDetect);
}

function onTouchMoveDetect(e) {
  onTouchEndDetect();
  if (e === 'timer') {
    original::onDragStart(longPressEvent);
    if (ua.isFirefox && parentCanScroll()) {
      // FF bug workaround: prevent the script list container from scrolling on drag
      parent.scrollTop += 1;
      parent.scrollTop -= 1;
    }
  }
}

function onTouchEndDetect() {
  clearTimeout(longPressTimer);
  document::off(eventNames.move, onTouchMoveDetect);
  document::off(eventNames.end, onTouchEndDetect);
}

function onDragStart(e) {
  original = this;
  if (e.cancelable) e.preventDefault();
  const { clientX: x, clientY: y } = e.touches?.[0] || e;
  const rect = original.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  dragged = original.cloneNode(true);
  elements = [...parent.children];
  index = elements.indexOf(original);
  lastIndex = index;
  elements.splice(index, 1);
  height = rect.height;
  offsetX = x - rect.left;
  offsetY = y - rect.top;
  scrollEdgeTop = parentRect.top + SCROLL_GAP;
  scrollEdgeBottom = parentRect.bottom - SCROLL_GAP;
  xyCache = {};
  original.classList.add('dragging-placeholder');
  dragged.classList.add('dragging');
  dragged.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
  dragged.style.width = `${rect.width}px`;
  parent.appendChild(dragged);
  if (isTouch) parent.insertAdjacentElement('afterBegin', noScroll);
  document::on(eventNames.move, onDragMouseMove);
  document::on(eventNames.end, onDragMouseUp);
}

function onDragMouseMove(e) {
  const { clientX: x, clientY: y, target } = e.touches?.[0] || e;
  let moved;
  const hovered = isTouch ? scriptFromPoint(x, y) : target.closest?.('.script');
  // FF bug: despite placeholder having `pointer-events:none` it's still reported in `target`
  if (hovered && hovered !== original) {
    const rect = hovered.getBoundingClientRect();
    const isDown = y > rect.top + rect.height / 2;
    moved = original !== hovered[`${isDown ? 'next' : 'previous'}ElementSibling`];
    if (moved) {
      hovered.insertAdjacentElement(isDown ? 'afterEnd' : 'beforeBegin', original);
      animate(elements.indexOf(hovered) + isDown);
    }
  }
  dragged.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
  if (maybeScroll(y) || moved) xyCache = {};
}

function onDragMouseUp() {
  document::off(eventNames.move, onDragMouseMove);
  document::off(eventNames.end, onDragMouseUp);
  stopScrolling();
  dragged.remove();
  if (isTouch) noScroll.remove();
  original.classList.remove('dragging-placeholder');
  original.dispatchEvent(new Event(DROP_EVENT_RELAY));
}

function animate(hoveredIndex) {
  const delta = lastIndex < hoveredIndex ? height : -height;
  const group = elements.slice(...lastIndex < hoveredIndex
    ? [lastIndex, hoveredIndex]
    : [hoveredIndex, lastIndex]);
  group.forEach(el => {
    el.style.transition = 'none';
    el.style.transform = `translateY(${delta}px)`;
  });
  setTimeout(() => group.forEach(el => el.removeAttribute('style')));
  lastIndex = hoveredIndex;
}

function parentCanScroll() {
  return parent.scrollHeight > parent.clientHeight;
}

function maybeScroll(y) {
  const delta = parentCanScroll()
                && Math.min(1, Math.max(0, y - scrollEdgeBottom, scrollEdgeTop - y) / SCROLL_GAP);
  if (!delta && scrollTimer) stopScrolling();
  if (delta && !scrollTimer) startScrolling();
  scrollSpeed = delta && (y > scrollEdgeBottom ? 1 : -1) * (1 + delta * MAX_SCROLL_SPEED | 0);
  scrollTimestamp = performance.now();
  return !!delta;
}

function doScroll() {
  // normalize scroll speed: on slower devices the step will be bigger
  const ts = performance.now();
  const distance = scrollSpeed * (ts - scrollTimestamp) / ONE_FRAME_MS;
  parent.scrollTop += distance;
  scrollTimestamp = ts;
}

function startScrolling() {
  scrollTimer = setInterval(doScroll, ONE_FRAME_MS);
  eventsToSuppress.forEach(name => window::on(name, stopPropagation, true));
}

function stopScrolling() {
  eventsToSuppress.forEach(name => window::off(name, stopPropagation, true));
  if (scrollTimer) clearInterval(scrollTimer);
  scrollTimer = 0;
}

// primary goal: don't update Vueleton/tooltip while drag-scrolling
function stopPropagation(e) {
  e.stopPropagation();
}

// touch devices are usually slooooow so touchmove causes jank due to frequent elementFromPoint
function scriptFromPoint(x, y) {
  const key = `${x}:${y}`;
  const el = xyCache[key] || (xyCache[key] = document.elementFromPoint(x, y)?.closest('.script'));
  return el;
}

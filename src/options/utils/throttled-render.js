import { route } from '#/common/router';

const MAX_BATCH_DURATION = 150;
/** @type ThrottledVue[] */
const queue = [];
// When script list is the initial navigation of this tab, startTime should start now
// so that the first batch is rendered earlier to compensate for main app init
let startTime = route.pathname === 'scripts' ? performance.now() : 0;
let batchSize = 0;
let maxBatchSize = 0;
let timer = 0;

/** @param { ThrottledVue } component */
export function register(component) {
  // first run: calculate maxBatchSize as a number of items rendered within MAX_BATCH_DURATION
  if (!maxBatchSize && !startTime) startTime = performance.now();
  if (component.renderStage === 'check') {
    const show = maxBatchSize
      ? batchSize < maxBatchSize
      : performance.now() - startTime < MAX_BATCH_DURATION;
    if (show) {
      batchSize += 1;
      component.renderStage = 'show';
      return false;
    }
    component.renderStage = 'hide';
  }
  queue.push(component);
  if (!timer) timer = setTimeout(renderNextBatch);
  return true;
}

export function unregister(component) {
  const i = queue.indexOf(component);
  if (i >= 0) queue.splice(i, 1);
}

function renderNextBatch() {
  const count = Math.min(queue.length, batchSize);
  for (let i = 0; i < count; i += 1) {
    queue[i].renderStage = 'check';
  }
  queue.splice(0, count);
  timer = queue.length && setTimeout(renderNextBatch);
  maxBatchSize = Math.max(10, batchSize);
  batchSize = 0;
  startTime = 0;
}

/**
 * @typedef { Vue } ThrottledVue
 * @property { ThrottledRenderStage } renderStage
 */

/**
 * @typedef { 'hide' | 'check' | 'show' } ThrottledRenderStage
 */

const MAX_BATCH_DURATION = 200;
/** @type ThrottledVue[] */
const queue = [];
let startTime = performance.now();
let batchSize = 0;
let timer = 0;

/** @param { ThrottledVue } component */
export function register(component) {
  if (!startTime) startTime = performance.now();
  if (component.renderStage === 'check') {
    if (performance.now() - startTime < MAX_BATCH_DURATION) {
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
  const count = Math.min(queue.length, Math.max(10, batchSize));
  for (let i = 0; i < count; i += 1) {
    queue[i].renderStage = 'check';
  }
  queue.splice(0, count);
  timer = queue.length && setTimeout(renderNextBatch);
  startTime = 0;
  batchSize = 0;
}

/**
 * @typedef { Vue } ThrottledVue
 * @property { ThrottledRenderStage } renderStage
 */

/**
 * @typedef { 'hide' | 'check' | 'show' } ThrottledRenderStage
 */

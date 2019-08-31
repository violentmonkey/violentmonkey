const initializers = [];

export function register(init) {
  initializers.push(init);
}

export function initialize() {
  return Promise.all(initializers.map((init) => {
    if (typeof init === 'function') return init();
    return init;
  }))
  .then(() => {});
}

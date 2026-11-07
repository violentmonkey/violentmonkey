class ForbidNamespaceFallbackPlugin {
  apply(compiler) {
    compiler.hooks.done.tap(this.constructor.name, stats => {
      for (const m of stats.compilation.modules) {
        if (m.type === 'runtime') {
          stats.compilation.errors.push(
            new Error(`${m.chunk.name}: imported namespace must be used as obj.prop and not as a standalone object.`)
          );
          break;
        }
      }
    });
  }
}

module.exports = ForbidNamespaceFallbackPlugin;

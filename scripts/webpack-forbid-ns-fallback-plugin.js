class ForbidNamespaceFallbackPlugin {
  apply(compiler) {
    compiler.hooks.done.tap(this.constructor.name, stats => {
      for (const m of stats.toJson({ modules: true }).modules) {
        if (m.moduleType === 'runtime') {
          stats.compilation.errors.push(
            new Error(`${m.chunks.join(', ')}: exported namespace was used as an object!`)
          );
          break;
        }
      }
    });
  }
}

module.exports = ForbidNamespaceFallbackPlugin;

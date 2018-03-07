<template>
  <div ref="monaco"></div>
</template>

<script>
import * as monaco from '@timkendrick/monaco-editor';

export default {
  props: {
    commands: true,
    global: {
      type: Boolean,
      default: true,
    },
    dirty: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      monacoEditor: null,
      dirtyVersion: 0,
    };
  },
  methods: {
    resizeEvent() {
      this.monacoEditor.layout();
    },
    onChange() {
      const dirty = this.dirtyVersion !== this.monacoEditor.getModel().getAlternativeVersionId();
      if (dirty !== this.dirty) {
        this.$emit('update:dirty', dirty);
      }
    },
    getValue() {
      return this.monacoEditor.getValue();
    },
    setValue(value) {
      this.monacoEditor.setValue(value);
      this.flush();
    },
    flush() {
      this.dirtyVersion = this.monacoEditor.getModel().getAlternativeVersionId();
    },
    keydownEvent(e) {
      switch (e.code) {
      case 'KeyS':
        if (e.ctrlKey) {
          this.commands.save();
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
        break;
      case 'Escape':
        this.commands.close();
        break;
      default:
      }
    },
  },
  mounted() {
    const monacoEditor = monaco.editor.create(this.$refs.monaco, {
      language: 'javascript',
      renderWhitespace: 'boundary',
      renderIndentGuides: true,
      fontLigatures: true,
      fontFamily: 'monospace',
      autoIndent: true,
    });
    this.monacoEditor = monacoEditor;
    monacoEditor.getModel().updateOptions({ tabSize: 2 });
    monacoEditor.onDidChangeModelContent(this.onChange);

    if (this.global) {
      window.addEventListener('keydown', this.keydownEvent, false);
      window.addEventListener('resize', this.resizeEvent, { capture: false, passive: true });
    }
  },
  beforeDestroy() {
    if (this.global) {
      window.removeEventListener('resize', this.resizeEvent, { capture: false, passive: true });
      window.removeEventListener('keydown', this.keydownEvent, false);
    }
    this.monacoEditor.destroy();
  },
};
</script>

<style>
</style>

<template>
  <section>
    <h3 v-text="i18n('labelEditor')"></h3>
    <p v-html="i18n('descEditorOptions')" />
    <setting-text name="editor" ref="editor" mode="application/json" :json="true" :has-reset="true"
                  @save="onSave">
      <button v-text="i18n('buttonShowEditorState')" @click="toggleStateHint"/>
    </setting-text>
    <pre v-text="hint" class="monospace-font dim-hint" />
  </section>
</template>

<script>
import options from '#/common/options';
import { showMessage } from '#/common/ui';
import SettingText from '#/common/ui/setting-text';

export default {
  data() {
    return { hint: null };
  },
  components: {
    SettingText,
  },
  mounted() {
    this.$refs.editor.$el.addEventListener('dblclick', this.toggleBoolean);
  },
  methods: {
    onSave() {
      showMessage({ text: this.$refs.editor.error || this.i18n('msgSavedEditorOptions') });
    },
    toggleBoolean(event) {
      const el = /** @type HTMLTextAreaElement */ event.target;
      const { selectionStart: start, selectionEnd: end, value } = el;
      const toggled = { false: 'true', true: 'false' }[value.slice(start, end)];
      // FF can't run execCommand on textarea, https://bugzil.la/1220696#c24
      if (toggled && !document.execCommand('insertText', false, toggled)) {
        el.value = value.slice(0, start) + toggled + value.slice(end);
        el.setSelectionRange(start + toggled.length, start + toggled.length);
        el.dispatchEvent(new Event('input'));
        el.onblur = () => el.dispatchEvent(new Event('change'));
      }
    },
    async toggleStateHint() {
      if (this.hint) {
        this.hint = null;
        return;
      }
      const HIDE_OPTS = [
        // we activate only one mode: js
        'mode',
        // duh
        'value',
        // these accept only a function
        'configureMouse',
        'lineNumberFormatter',
        'specialCharPlaceholder',
      ];
      const opts = {};
      Object.entries({
        ...(await import('codemirror')).defaults,
        ...(await import('#/common/ui/code')).default.data().cmDefaults,
        ...options.get('editor'),
      })
      // sort by keys alphabetically to make it more readable
      .sort(([a], [b]) => (a < b ? -1 : a > b))
      .filter(([key, val]) => !HIDE_OPTS.includes(key) && typeof val !== 'function')
      .forEach(([key, val]) => { opts[key] = val; });
      this.hint = JSON.stringify(opts, null, '  ');
      setTimeout(() => {
        if (this.$el.getBoundingClientRect().bottom > window.innerHeight) {
          this.$el.scrollIntoView({ behavior: 'smooth' });
        }
      });
    },
  },
};
</script>

<style>
  .dim-hint {
    font-size: .85rem;
    color: var(--fill-8);
  }
</style>

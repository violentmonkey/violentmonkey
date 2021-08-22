<template>
  <div class="setting-text">
    <vm-code
      v-if="canShowCm" ref="code" :commands="{ save: onSave }" :mode="mode"
      class="value monospace-font mb-1"
      :class="{'has-error': parsedData.error}"
      :title="parsedData.error"
      @code-dirty="value = $refs.code.cm.getValue()"
      @change="onChange"
    />
    <textarea
      v-else-if="!mode" v-model="value" spellcheck="false"
      class="value monospace-font mb-1"
      :class="{'has-error': parsedData.error}"
      :disabled="disabled"
      :title="parsedData.error"
      @change="onChange"
    />
    <div class="mr-1c">
      <button v-if="hasSave" v-text="i18n('buttonSave')" @click="onSave"
              :disabled="disabled || !canSave"/>
      <button v-if="hasReset" v-text="i18n('buttonReset')" @click="onReset"
              :disabled="disabled || !canReset"/>
      <slot/>
    </div>
  </div>
</template>

<script>
import VmCode from '#/common/ui/code';
import { getUnloadSentry } from '#/common/router';
import { showMessage } from '#/common/ui';
import { deepEqual, objectGet } from '../object';
import options from '../options';
import defaults from '../options-defaults';
import hookSetting from '../hook-setting';

/** @type IntersectionObserver */
let xo;

export default {
  props: {
    name: String,
    mode: String,
    msgOnSave: String,
    json: Boolean,
    disabled: Boolean,
    hasSave: {
      type: Boolean,
      default: true,
    },
    hasReset: Boolean,
  },
  data() {
    return {
      value: null,
      savedValue: null,
      canShowCm: false,
    };
  },
  components: {
    VmCode,
  },
  computed: {
    parsedData() {
      let value;
      let error;
      if (this.json) {
        try {
          value = JSON.parse(this.value);
        } catch (e) {
          error = e.message || e;
        }
      } else {
        value = this.value;
      }
      return { value, error };
    },
    isDirty() {
      return !deepEqual(this.parsedData.value, this.savedValue || '');
    },
    canSave() {
      return !this.parsedData.error && this.isDirty;
    },
    canReset() {
      return !deepEqual(this.parsedData.value, this.defaultValue || '');
    },
  },
  watch: {
    isDirty(state) {
      this.toggleUnloadSentry(state);
    },
  },
  mounted() {
    // Not handling `disabled` because we don't use it anyway
    if (this.mode) {
      const el = this.$el;
      el.$vm = this;
      if (!xo) {
        xo = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const { target } = entry;
              const vm = target.$vm;
              xo.unobserve(target);
              vm.canShowCm = true;
              vm.init?.();
            }
          });
        });
      }
      xo.observe(el);
    } else {
      this.init?.();
    }
  },
  beforeDestroy() {
    this.revoke();
    this.toggleUnloadSentry(false);
  },
  methods: {
    init() {
      delete this.init;
      const handle = this.json
        ? (value => JSON.stringify(value, null, '  '))
        // XXX compatible with old data format
        : (value => (Array.isArray(value) ? value.join('\n') : value || ''));
      this.revoke = hookSetting(this.name, val => {
        this.savedValue = val;
        this.value = handle(val);
      });
      this.defaultValue = objectGet(defaults, this.name);
      this.toggleUnloadSentry = getUnloadSentry(() => {
        // Reset to saved value after confirming loss of data.
        // The component won't be destroyed on tab change, so the changes are actually kept.
        // Here we reset it to make sure the user loses the changes when leaving the settings tab.
        // Otherwise the user may be confused about where the changes are after switching back.
        this.value = handle(this.savedValue);
      });
      if (this.mode) {
        this.$watch('value', val => { this.$refs.code.value = val; });
      }
    },
    onChange() {
      // Auto save if there is no `Save` button
      if (!this.hasSave && this.canSave) this.onSave();
    },
    onSave() {
      options.set(this.name, this.parsedData.value);
      if (this.msgOnSave) {
        showMessage({ text: this.msgOnSave });
      }
      this.$emit('save');
    },
    onReset() {
      options.set(this.name, this.defaultValue);
    },
  },
};
</script>

<style>
.setting-text {
  > .value {
    height: 10em;
    border: 1px solid var(--fill-4);
    &:active {
      border-color: var(--fill-9);
    }
    > .abs-full {
      position: static;
    }
  }
}
</style>

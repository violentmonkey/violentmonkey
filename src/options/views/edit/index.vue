<template>
  <div class="edit frame flex flex-col fixed-full">
    <div class="edit-header flex">
      <nav>
        <div
          class="edit-nav-item"
          :class="{active: nav === 'code'}"
          v-text="i18n('editNavCode')"
          @click="nav = 'code'"
        />
        <div
          class="edit-nav-item"
          :class="{active: nav === 'settings'}"
          v-text="i18n('editNavSettings')"
          @click="nav = 'settings'"
        />
        <div
          class="edit-nav-item"
          :class="{active: nav === 'values'}"
          v-if="scriptId"
          v-text="i18n('editNavValues')"
          @click="nav = 'values'"
        />
        <div
          class="edit-nav-item"
          :class="{active: nav === 'help'}"
          @click="nav = 'help'"
        >?</div>
      </nav>
      <div class="edit-name text-center ellipsis flex-1 mr-1" v-text="scriptName"/>
      <div class="edit-hint text-right ellipsis mr-1">
        <a href="https://violentmonkey.github.io/posts/how-to-edit-scripts-with-your-favorite-editor/"
           target="_blank"
           rel="noopener noreferrer"
           v-text="i18n('editHowToHint')"/>
      </div>
      <div class="edit-buttons mr-1">
        <button v-text="i18n('buttonSave')" @click="save" :disabled="!canSave"/>
        <button v-text="i18n('buttonSaveClose')" @click="saveClose" :disabled="!canSave"/>
        <button v-text="i18n('buttonClose')" @click="close"/>
      </div>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code
        v-show="nav === 'code'" class="abs-full" ref="code" :editing="nav === 'code'"
        v-model="code" :commands="commands"
      />
      <vm-settings
        v-show="nav === 'settings'" class="abs-full edit-body"
        :value="script" :settings="settings"
      />
      <vm-values
        :show="nav === 'values'" class="abs-full edit-body" :script="script"
      />
      <vm-help
        v-if="nav === 'help'" class="abs-full edit-body"
        :target="this.$refs.code"
      />
    </div>
  </div>
</template>

<script>
import { i18n, sendCmd, noop } from '#/common';
import { objectGet } from '#/common/object';
import VmCode from '#/common/ui/code';
import { route } from '#/common/router';
import { store, showMessage } from '../../utils';
import VmSettings from './settings';
import VmValues from './values';
import VmHelp from './help';

function fromList(list) {
  return (list || []).join('\n');
}
function toList(text) {
  return text.split('\n')
  .map(line => line.trim())
  .filter(Boolean);
}

export default {
  props: ['initial'],
  components: {
    VmCode,
    VmSettings,
    VmValues,
    VmHelp,
  },
  data() {
    return {
      nav: 'code',
      canSave: false,
      script: null,
      code: '',
      settings: {},
      commands: {
        save: this.save,
        close: () => this.close({ fromCM: true }),
        showHelp: () => {
          this.nav = 'help';
        },
      },
    };
  },
  computed: {
    scriptName() {
      const { custom, meta } = this.script || {};
      const scriptName = custom && custom.name || meta && meta.name;
      store.title = scriptName;
      return scriptName;
    },
    scriptId() {
      return this.script?.props?.id;
    },
  },
  watch: {
    code() {
      this.canSave = true;
    },
    settings: {
      deep: true,
      handler() {
        this.canSave = true;
      },
    },
    nav() {
      setTimeout(() => this.nav === 'code' && this.$refs.code.cm.focus());
    },
  },
  created() {
    this.script = this.initial;
  },
  mounted() {
    const id = objectGet(this.script, 'props.id');
    (id
      ? sendCmd('GetScriptCode', id)
      : sendCmd('NewScript', route.paths[2])
      .then(({ script, code }) => {
        this.script = script;
        return code;
      })
    )
    .then((code) => {
      this.code = code;
      const settings = {};
      const { custom, config } = this.script;
      settings.config = {
        shouldUpdate: config.shouldUpdate,
      };
      settings.custom = [
        'name',
        'homepageURL',
        'updateURL',
        'downloadURL',
        'origInclude',
        'origExclude',
        'origMatch',
        'origExcludeMatch',
      ].reduce((value, key) => {
        value[key] = custom[key];
        return value;
      }, {
        include: fromList(custom.include),
        match: fromList(custom.match),
        exclude: fromList(custom.exclude),
        excludeMatch: fromList(custom.excludeMatch),
        runAt: custom.runAt || '',
      });
      this.settings = settings;
      this.$nextTick(() => {
        this.canSave = false;
      });
    });
  },
  methods: {
    save() {
      const { settings: { config, custom: rawCustom } } = this;
      const custom = [
        'name',
        'runAt',
        'homepageURL',
        'updateURL',
        'downloadURL',
        'origInclude',
        'origExclude',
        'origMatch',
        'origExcludeMatch',
      ].reduce((val, key) => {
        val[key] = rawCustom[key];
        return val;
      }, {
        include: toList(rawCustom.include),
        match: toList(rawCustom.match),
        exclude: toList(rawCustom.exclude),
        excludeMatch: toList(rawCustom.excludeMatch),
      });
      const id = objectGet(this.script, 'props.id');
      return sendCmd('ParseScript', {
        id,
        custom,
        config,
        code: this.code,
        // User created scripts MUST be marked `isNew` so that
        // the backend is able to check namespace conflicts,
        // otherwise the script with same namespace will be overridden
        isNew: !id,
        message: '',
      })
      .then((res) => {
        this.canSave = false;
        if (objectGet(res, 'where.id')) this.script = res.update;
      }, (err) => {
        showMessage({ text: err });
      });
    },
    close({ fromCM } = {}) {
      if (fromCM && this.nav !== 'code') {
        this.nav = 'code';
        return;
      }
      (this.canSave ? Promise.reject() : Promise.resolve())
      .catch(() => new Promise((resolve, reject) => {
        showMessage({
          input: false,
          text: i18n('confirmNotSaved'),
          buttons: [
            {
              text: i18n('buttonOK'),
              onClick: resolve,
            },
            {
              text: i18n('buttonCancel'),
              onClick: reject,
            },
          ],
          onBackdropClick: reject,
        });
      }))
      .then(() => this.$emit('close'), noop);
    },
    saveClose() {
      this.save().then(this.close);
    },
  },
  beforeDestroy() {
    store.title = null;
  },
};
</script>

<style>
.edit {
  z-index: 2000;
  &-header {
    align-items: center;
    justify-content: space-between;
  }
  &-name {
    font-weight: bold;
  }
  &-body {
    padding: .5rem 1rem;
    overflow: auto;
    background: white;
  }
  &-nav-item {
    display: inline-block;
    padding: 8px 16px;
    cursor: pointer;
    &.active {
      background: white;
      box-shadow: 0 -1px 1px #888;
    }
    &:not(.active):hover {
      background: #fff8;
      box-shadow: 0 -1px 1px #bbb;
    }
  }
}

@media (max-width: 767px) {
  .edit-hint {
    display: none;
  }
}

@media (max-width: 500px) {
  .edit-name {
    display: none;
  }
}
</style>

<template>
  <div class="edit frame flex flex-col fixed-full">
    <div class="flex flex-wrap edit-header mx-1 my-1">
      <div class="edit-info text-right ellipsis">
        <strong v-text="i18n('labelEditing')"></strong>
        <em v-text="scriptName"></em>
      </div>
      <div class="flex-auto flex">
        <div class="edit-hint flex-auto text-right ellipsis mr-1">
          <a href="https://violentmonkey.github.io/2017/03/14/How-to-edit-scripts-with-your-favorite-editor/" target="_blank" rel="noopener noreferrer">How to edit with your favorite editor?</a>
        </div>
        <div class="edit-buttons">
          <button v-text="i18n('buttonSave')" @click="save" :disabled="!canSave"></button>
          <button v-text="i18n('buttonSaveClose')" @click="saveClose" :disabled="!canSave"></button>
          <button v-text="i18n('buttonClose')" @click="close"></button>
        </div>
      </div>
    </div>
    <div class="flex mx-1">
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
        v-text="i18n('editNavValues')"
        @click="nav = 'values'"
      />
      <div class="flex-auto pos-rel">
        <div
          v-if="tooLarge"
          class="edit-warn text-red hidden-sm"
          v-text="i18n('warnScriptLongLines')"
        />
      </div>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code
        v-show="nav === 'code'" class="abs-full"
        v-model="code" :commands="commands" @warnLarge="onWarnLarge"
      />
      <vm-settings
        v-show="nav === 'settings'" class="abs-full edit-body"
        :value="script" :settings="settings"
      />
      <vm-values
        :show="nav === 'values'" class="abs-full edit-body" :script="script"
      />
    </div>
  </div>
</template>

<script>
import { i18n, sendMessage, noop } from '#/common';
import { objectGet } from '#/common/object';
import VmCode from '#/common/ui/code';
import { route } from '#/common/router';
import { store, showMessage } from '../../utils';
import VmSettings from './settings';
import VmValues from './values';

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
  },
  data() {
    return {
      nav: 'code',
      canSave: false,
      script: null,
      tooLarge: false,
      code: '',
      settings: {},
      commands: {
        save: this.save,
        close: this.close,
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
  },
  created() {
    this.script = this.initial;
  },
  mounted() {
    const id = objectGet(this.script, 'props.id');
    (id
      ? sendMessage({
        cmd: 'GetScriptCode',
        data: id,
      })
      : sendMessage({
        cmd: 'NewScript',
        data: route.paths[2],
      })
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
      return sendMessage({
        cmd: 'ParseScript',
        data: {
          id,
          custom,
          config,
          code: this.code,
          // User created scripts MUST be marked `isNew` so that
          // the backend is able to check namespace conflicts,
          // otherwise the script with same namespace will be overridden
          isNew: !id,
          message: '',
        },
      })
      .then((res) => {
        this.canSave = false;
        if (objectGet(res, 'where.id')) this.script = res.update;
      }, (err) => {
        showMessage({ text: err });
      });
    },
    close() {
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
    onWarnLarge(tooLarge) {
      this.tooLarge = tooLarge;
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
  &-body {
    padding: .5rem 1rem;
    overflow: auto;
    background: white;
  }
  &-nav-item {
    display: inline-block;
    padding: 8px 16px;
    cursor: pointer;
    color: #bbb;
    &.active {
      background: white;
      box-shadow: 0 -1px 1px #bbb;
      color: #333;
    }
    &:hover {
      box-shadow: 0 -1px 1px #bbb;
    }
  }
}

.edit-warn {
  position: absolute;
  left: 0;
  right: .5rem;
  bottom: .5rem;
  text-align: right;
}

@media (max-width: 767px) {
  .edit-header > h2,
  .edit-hint,
  .edit-info {
    display: none;
  }
}
</style>

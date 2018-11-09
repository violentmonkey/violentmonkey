<template>
  <div class="edit frame flex flex-col fixed-full">
    <div class="flex flex-wrap edit-header mx-1 my-1">
      <div class="edit-info text-right ellipsis">
        <strong v-text="i18n('labelEditing')"></strong>
        <em v-text="scriptName"></em>
      </div>
      <div class="flex-auto flex">
        <div class="edit-hint flex-auto text-right ellipsis mr-1">
          <a href="https://violentmonkey.github.io/2017/03/14/How-to-edit-scripts-with-your-favorite-editor/" target="_blank">How to edit with your favorite editor?</a>
        </div>
        <div class="edit-buttons">
          <button v-text="i18n('buttonSave')" @click="save" :disabled="!canSave"></button>
          <button v-text="i18n('buttonSaveClose')" @click="saveClose" :disabled="!canSave"></button>
          <button v-text="i18n('buttonClose')" @click="close"></button>
          <div class="text-red mt-1" v-if="tooLarge" v-text="i18n('warnScriptLongLines')"></div>
        </div>
      </div>
    </div>
    <div class="edit-nav mx-1">
      <div class="edit-nav-item" v-text="i18n('editNavCode')" :class="{active: nav === 'code'}" @click="nav = 'code'"></div>
      <div class="edit-nav-item" v-text="i18n('editNavSettings')" :class="{active: nav === 'settings'}" @click="nav = 'settings'"></div>
      <div class="edit-nav-item" v-text="i18n('editNavValues')" :class="{active: nav === 'values'}" @click="nav = 'values'"></div>
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
import { showMessage } from '../../utils';
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
      return custom && custom.name || meta && meta.name;
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
    .then(code => {
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
        runAt: custom.runAt || custom['run-at'] || '',
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
      .then(res => {
        this.canSave = false;
        if (objectGet(res, 'where.id')) this.script = res.update;
      }, err => {
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
};
</script>

<style>
.edit {
  z-index: 2000;
  &-body {
    padding: 8px 16px;
    overflow: auto;
    background: white;
  }
  &-nav {
    .text-red {
      margin-left: 8px;
    }
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

@media (max-width: 767px) {
  .edit-header > h2,
  .edit-hint,
  .edit-info {
    display: none;
  }
}
</style>

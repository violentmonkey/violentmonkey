<template>
  <div class="edit-values" v-show="show">
    <div class="mb-1">
      <button @click="onNew">+</button>
      <div class="inline-block ml-2" v-if="totalPages > 1">
        <button :disabled="!hasPrevious" @click="page = currentPage.page - 1">&larr;</button>
        <span class="mx-1" v-text="page"></span>
        <button :disabled="!hasNext" @click="page = currentPage.page + 1">&rarr;</button>
      </div>
    </div>
    <div class="edit-values-table" v-if="keys">
      <div class="edit-values-empty" v-if="!keys.length">
        <div v-text="i18n('noValues')"></div>
      </div>
      <div
        v-for="key in currentPage.data"
        :key="key"
        class="edit-values-row flex"
        @click="onEdit(key)">
        <div class="ellipsis">
          <span v-text="key"></span>
          <div class="edit-values-btn">
            <span @click.stop="onRemove(key)">
              <icon name="trash" />
            </span>
          </div>
        </div>
        <div class="ellipsis flex-auto" v-text="getValue(key, true)"></div>
      </div>
    </div>
    <div class="edit-values-panel flex flex-col" v-if="current">
      <div class="flex mb-1">
        <h4 class="flex-auto" v-text="i18n('labelEditValue')"></h4>
        <div>
          <button v-text="i18n('editValueSave')" @click="onSave"></button>
          <button v-text="i18n('editValueCancel')" @click="onCancel"></button>
        </div>
      </div>
      <label class="mb-1" v-text="i18n('valueLabelKey')"></label>
      <input type="text" v-model="current.key" :readOnly="!current.isNew">
      <label class="mt-1 mb-1" v-text="i18n('valueLabelValue')"></label>
      <textarea class="flex-auto" v-model="current.value"></textarea>
    </div>
  </div>
</template>

<script>
import { sendMessage } from '#/common';
import Icon from '#/common/ui/icon';

const PAGE_SIZE = 25;
const MAX_LENGTH = 1024;

export default {
  props: ['show', 'script'],
  components: {
    Icon,
  },
  data() {
    return {
      current: null,
      keys: null,
      values: null,
    };
  },
  computed: {
    totalPages() {
      if (!this.keys) return 0;
      return Math.floor(this.keys.length / PAGE_SIZE) + 1;
    },
    currentPage() {
      const page = Math.max(1, Math.min(this.page, this.totalPages));
      const offset = PAGE_SIZE * (page - 1);
      return {
        page,
        data: this.keys ? this.keys.slice(offset, offset + PAGE_SIZE) : null,
      };
    },
    hasPrevious() {
      return this.currentPage.page > 1;
    },
    hasNext() {
      return this.currentPage.page < this.totalPages;
    },
  },
  watch: {
    show(show) {
      if (show && !this.keys) this.refresh();
    },
  },
  methods: {
    getValue(key, sliced) {
      let value = this.values[key];
      const type = value[0];
      value = value.slice(1);
      if (type === 's') value = JSON.stringify(value);
      if (sliced && value.length > MAX_LENGTH) {
        value = value.slice(0, MAX_LENGTH);
      }
      return value;
    },
    refresh() {
      sendMessage({ cmd: 'GetValueStore', data: this.script.props.id })
      .then((values) => {
        this.values = values;
        this.keys = Object.keys(values).sort();
        this.page = 1;
      });
    },
    updateValue({ key, value, isNew }) {
      const rawValue = value ? `o${value}` : '';
      return sendMessage({
        cmd: 'UpdateValue',
        data: {
          id: this.script.props.id,
          update: {
            key,
            value: rawValue,
          },
        },
      })
      .then(() => {
        if (value) {
          this.$set(this.values, key, rawValue);
          if (isNew) this.keys.push(key);
        } else {
          const i = this.keys.indexOf(key);
          if (i >= 0) this.keys.splice(i, 1);
          this.$delete(this.values, key);
        }
      });
    },
    onNew() {
      this.current = {
        isNew: true,
        key: '',
        value: '',
      };
    },
    onRemove(key) {
      this.updateValue({ key })
      .then(() => {
        if (this.current && this.current.key === key) {
          this.current = null;
        }
      });
    },
    onEdit(key) {
      this.current = {
        isNew: false,
        key,
        value: this.getValue(key),
      };
    },
    onSave() {
      this.updateValue(this.current)
      .then(() => {
        this.current = null;
      });
    },
    onCancel() {
      this.current = null;
    },
  },
  created() {
    let unwatch;
    const init = () => {
      if (this.show) {
        this.refresh();
        if (unwatch) unwatch();
      }
    };
    unwatch = this.$watch('show', init);
    init();
  },
};
</script>

<style>
.edit-values {
  &-row {
    border: 1px solid #ddd;
    &:not(:first-child) {
      border-top: 0;
    }
    > * {
      font-size: 12px;
      padding: 4px 6px;
      &:first-child {
        position: relative;
        width: 30%;
        max-width: 240px;
      }
      &:not(:first-child) {
        border-left: 1px solid #ddd;
      }
    }
    :not(:hover) .edit-values-btn {
      display: none;
    }
  }
  &-empty {
    color: #888;
  }
  &-panel {
    position: absolute;
    top: 0;
    right: 0;
    width: 50%;
    height: 100%;
    padding: 8px;
    box-shadow: -5px 0 5px #ddd;
    background: white;
    z-index: 10;
    @media (max-width: 767px) {
      width: 100%;
    }
    input {
      width: 100%;
    }
    textarea {
      width: 100%;
      word-break: break-all;
      resize: none;
    }
  }
  &-btn {
    position: absolute;
    top: 0;
    right: 0;
    padding: 4px;
    background: white;
    box-shadow: -5px 0 5px white;
  }
}
</style>

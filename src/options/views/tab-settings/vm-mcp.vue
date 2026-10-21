<template>
  <section ref="$el" class="mb-1c vm-mcp">
    <h3 v-text="i18n('labelMcp')" :class="{ bright: state.pending }" :data-status="state.pending ? 'pending' : state.status" />
    <div v-if="state.pending">
      <p v-text="i18n('labelMcpPending', [state.pending.port])" />
      <button v-text="i18n('buttonApprove')" @click="run('McpApprove')" />
      <button class="ml-1" v-text="i18n('buttonReject')" @click="run('McpReject')" />
    </div>
    <div v-else-if="state.status === 'open' || state.status === 'connecting'">
      <span v-if="state.status === 'open'" v-text="i18n('labelMcpConnected', [state.port])" />
      <span v-else v-text="i18n('labelMcpConnecting', [state.port])" />
      <button class="ml-1" v-text="i18n('buttonDisconnect')" @click="run('McpDisconnect')" />
    </div>
    <p v-else-if="state.status === 'closed'" v-text="i18n('labelMcpClosed')" />
    <p v-else v-text="i18n('labelMcpNoRequests')" />
    <p>
      <a :href="GUIDE_URL" target="_blank" rel="noopener noreferrer" v-text="i18n('labelMcpGuide')" />
    </p>
    <div v-if="connected" class="vm-mcp-grant">
      <div class="vm-mcp-head">
        <h4 v-text="i18n('labelMcpGrantTitle')" />
        <label v-if="tabs.length" class="vm-mcp-search">
          <Icon name="search" />
          <input v-model="query" type="search" />
        </label>
      </div>
      <div v-if="tabs.length" class="vm-mcp-tabs">
        <table>
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  :checked="allGranted"
                  :indeterminate.prop="someGranted && !allGranted"
                  :disabled="!visibleTabs.length"
                  :title="i18n('labelMcpAll')"
                  :aria-label="i18n('labelMcpAll')"
                  @change="toggleAll($event.target.checked)"
                />
              </th>
              <th scope="col" v-text="i18n('labelMcpTabs')" />
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="tab in visibleTabs"
              :key="tab.tabId"
              :data-granted="tab.granted ? 1 : 0"
              @click="toggle(tab.tabId, !tab.granted)"
            >
              <td>
                <input
                  type="checkbox"
                  :checked="tab.granted"
                  @click.stop
                  @change="toggle(tab.tabId, $event.target.checked)"
                />
              </td>
              <td class="ellipsis" :title="tab.url" v-text="tab.title || tab.url" />
              <td>
                <span
                  v-if="tab.capturing"
                  class="vm-mcp-dot"
                  :title="i18n('labelMcpCapturing')"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else v-text="i18n('labelMcpNoTabs')" />
    </div>
  </section>
</template>

<script setup>
import { computed, onActivated, onDeactivated, nextTick, reactive, ref } from 'vue';
import { i18n, sendCmdDirectly } from '@/common';
import Icon from '@/common/ui/icon';

const GUIDE_URL = 'https://violentmonkey.github.io/guide/ai-agent-access/';
const $el = ref();
const state = reactive({ status: 'idle', pending: null, port: null });
const tabs = ref([]);
const query = ref('');
const connected = computed(() => state.status === 'open');
const visibleTabs = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q
    ? tabs.value.filter(tab => `${tab.title} ${tab.url}`.toLowerCase().includes(q))
    : tabs.value;
});
const grantedCount = computed(() => visibleTabs.value.filter(tab => tab.granted).length);
const allGranted = computed(() => grantedCount.value > 0 && grantedCount.value === visibleTabs.value.length);
const someGranted = computed(() => grantedCount.value > 0);
let timer;
let scrolled = false;

async function refresh() {
  Object.assign(state, await sendCmdDirectly('McpGetState'));
}

async function refreshTabs() {
  tabs.value = connected.value ? await sendCmdDirectly('McpGetTabs') : [];
}

async function run(cmd) {
  await sendCmdDirectly(cmd);
  await refresh();
}

async function toggle(tabId, granted) {
  await sendCmdDirectly(granted ? 'McpGrantTab' : 'McpRevokeTab', tabId);
  await refreshTabs();
}

/** The All box applies to what the filter is showing, not to hidden tabs */
async function toggleAll(granted) {
  const targets = visibleTabs.value.filter(tab => tab.granted !== granted);
  await Promise.all(targets.map(({ tabId }) => sendCmdDirectly(
    granted ? 'McpGrantTab' : 'McpRevokeTab', tabId,
  )));
  await refreshTabs();
}

onActivated(async () => {
  // Status first: the tab list is only fetched while connected
  await refresh();
  await refreshTabs();
  if (state.pending && !scrolled) {
    scrolled = true;
    await nextTick();
    $el.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  timer = setInterval(async () => {
    const { status } = state;
    await refresh();
    // Grants die with the connection, so the list follows the status
    if (state.status !== status) await refreshTabs();
  }, 1000);
});
onDeactivated(() => clearInterval(timer));
</script>

<style>
.vm-mcp h3 {
  &[data-status=pending] {
    background: var(--hbg);
    color: var(--fill-15);
  }
  &[data-status=open] {
    color: var(--fill-15);
  }
  &[data-status=connecting] {
    color: var(--fill-7);
  }
  &[data-status=closed] {
    background: #f002;
  }
}
.vm-mcp h4 {
  font-size: .9rem;
  font-weight: 500;
}
/* The settings panel shrinks every child of a section to its content */
.vm-mcp-grant {
  width: 100%;
}
.vm-mcp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .3em .5em;
  margin: .5em 0 .3em;

  & > h4 {
    flex: 1 0 auto;
  }
}
.vm-mcp-search {
  position: relative;
  flex: 0 0 9em;
  display: flex;
  align-items: center;

  & > .icon {
    position: absolute;
    left: .25em;
    /* decoration only: the click has to reach the field underneath */
    pointer-events: none;
    color: var(--fill-7);
  }

  & > input {
    width: 100%;
    min-width: 0;
    height: 1.5rem;
    padding: 0 .3em 0 1.6em;
  }
}
.vm-mcp-tabs {
  max-height: 12em;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--fill-4);
  border-radius: .25em;
  /* no padding: it would show above the sticky header */

  & table {
    width: 100%;
    border-collapse: collapse;
  }

  & th {
    position: sticky;
    top: 0;
    /* opaque and tinted, so rows scroll under it and it still reads as a header */
    background: var(--fill-1);
    border-bottom: 1px solid var(--fill-4);
    padding: .2em .4em;
    font-size: .85em;
    font-weight: 400;
    color: var(--fill-9);
    text-align: left;
  }

  /* 1% = shrink to content, so the name column takes the rest */
  & th:first-child,
  & th:last-child {
    width: 1%;
  }

  & td.ellipsis {
    /* auto layout: this is what lets the name column absorb the leftover width */
    max-width: 0;
  }

  & tbody tr {
    cursor: pointer;
    color: var(--fill-9);

    & > td {
      padding: .2em .4em;
    }

    & > td:last-child {
      text-align: right;
    }

    &:hover {
      background: var(--fill-2);
    }

    &[data-granted="1"] {
      color: var(--fg);
    }
  }
}
/* A status marker, deliberately not an icon: it must not look clickable */
.vm-mcp-dot {
  display: inline-block;
  width: .5em;
  height: .5em;
  border-radius: 50%;
  background: currentColor;
  vertical-align: middle;
}
</style>

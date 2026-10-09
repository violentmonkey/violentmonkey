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
  </section>
</template>

<script setup>
import { onActivated, onDeactivated, nextTick, reactive, ref } from 'vue';
import { i18n, sendCmdDirectly } from '@/common';

const GUIDE_URL = 'https://violentmonkey.github.io/guide/ai-agent-access/';
const $el = ref();
const state = reactive({ status: 'idle', pending: null, port: null });
let timer;
let scrolled = false;


async function refresh() {
  Object.assign(state, await sendCmdDirectly('McpGetState'));
}

async function run(cmd) {
  await sendCmdDirectly(cmd);
  await refresh();
}

onActivated(async () => {
  await refresh();
  if (state.pending && !scrolled) {
    scrolled = true;
    await nextTick();
    $el.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  timer = setInterval(refresh, 1000);
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
</style>

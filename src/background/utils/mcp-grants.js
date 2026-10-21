/**
 * Tabs the user allowed an agent to act on. Memory only: a grant dies with its tab,
 * so a recycled tab id can't inherit a stale one.
 */

/** @type {Set<number>} */
const grants = new Set();

export const hasGrant = tabId => grants.has(tabId);

export const grantTab = (tabId) => {
  if (tabId >= 0) grants.add(tabId);
};

export const revokeTab = tabId => grants.delete(tabId);

/** @returns {number[]} */
export const listGrants = () => [...grants];

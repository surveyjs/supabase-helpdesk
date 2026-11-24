/**
 * Cookie remembering that the agent hid the Views & Filters column (#105).
 * Read by the server page, written by AgentFiltersLayout. Kept out of the
 * 'use client' modules: a server component importing a value from one gets a
 * client reference, not the string.
 */
export const AGENT_FILTERS_HIDDEN_COOKIE = 'hd_agent_filters_hidden';

'use strict';

const { clean, list, number } = require('./state');

const entries = (value, key) => list(value?.[key]).slice(0, 150);
const short = value => clean(value, 180);

function effective(response) {
  const config = response?.config || {};
  const keys = ['model', 'model_provider', 'model_reasoning_effort', 'sandbox_mode', 'approval_policy', 'web_search', 'service_tier'];
  return keys.map(key => {
    const value = config[key];
    const source = response?.origins?.[key]?.name;
    return {
      name: key.replaceAll('_', ' '),
      value: short(typeof value === 'object' && value ? Object.keys(value).join(', ') : value) || null,
      source: short(typeof source === 'object' && source ? source.type : source) || null,
    };
  });
}

function models(response) {
  return entries(response, 'data').filter(model => !model.hidden && typeof model.model === 'string')
    .map(model => ({
      id: model.model, name: short(model.displayName) || short(model.model),
      efforts: list(model.supportedReasoningEfforts).map(effort => short(effort.reasoningEffort)).filter(Boolean),
    }));
}

function rateLimits(response, previous = []) {
  const buckets = { ...response?.rateLimitsByLimitId };
  if (response?.rateLimits) buckets[response.rateLimits.limitId || 'codex'] ??= response.rateLimits;
  const updates = Object.entries(buckets).slice(0, 20).flatMap(([id, limits]) => ['primary', 'secondary'].flatMap(kind => {
    const window = limits?.[kind];
    if (!window) return [];
    return [{
      id: id + '/' + kind, name: short(limits.limitName) || short(id), kind,
      percent: number(window.usedPercent), minutes: number(window.windowDurationMins), reset: number(window.resetsAt),
    }];
  }));
  const merged = new Map(previous.map(row => [row.id, row]));
  for (const row of updates) {
    const prior = merged.get(row.id);
    merged.set(row.id, { ...row, minutes: row.minutes ?? prior?.minutes ?? null, reset: row.reset ?? prior?.reset ?? null });
  }
  return [...merged.values()].slice(0, 40);
}

async function readInventory(rpc, cwd, threadId) {
  const methods = [
    ['MCP servers', 'mcpServerStatus/list', { limit: 150, ...(threadId ? { threadId } : {}) }, value =>
      entries(value, 'data').map(row => ({
        name: short(row.name), detail: [short(row.authStatus), short(row.runtimeStatus), row.toolsError ? 'Tool inventory unavailable' : ''].filter(Boolean).join(' · '),
        children: [...Object.keys(row.tools || {}), ...list(row.resources).map(resource => resource.name),
          ...list(row.resourceTemplates).map(resource => resource.name)].slice(0, 100).map(short),
      }))],
    ['Skills', 'skills/list', { cwds: [cwd] }, value =>
      entries(value, 'data').flatMap(entry => entries(entry, 'skills')).slice(0, 150).map(row => ({
        name: short(row.name), path: clean(row.path, 4000), pluginId: short(row.pluginId), enabled: row.enabled === true,
        detail: [short(row.scope), row.enabled ? 'enabled' : 'disabled', short(row.pluginId)].filter(Boolean).join(' · '),
      }))],
    ['Plugins', 'plugin/installed', { cwds: [cwd] }, value =>
      entries(value, 'marketplaces').flatMap(entry => entries(entry, 'plugins')).slice(0, 150).map(row => ({
        name: short(row.name), id: short(row.id), enabled: row.installed && row.enabled,
        detail: [row.enabled ? 'enabled' : 'disabled', short(row.localVersion || row.version)].filter(Boolean).join(' · '),
      }))],
    ['Connected apps', 'app/installed', threadId ? { threadId } : {}, value =>
      entries(value, 'apps').map(row => ({
        name: short(row.runtimeName || row.id), id: short(row.id), enabled: row.callable === true, detail: row.callable ? 'callable' : row.enabled ? 'enabled' : 'disabled',
      }))],
    ['Hooks', 'hooks/list', { cwds: [cwd] }, value =>
      entries(value, 'data').flatMap(entry => entries(entry, 'hooks')).slice(0, 150).map(row => ({
        name: short(row.eventName), detail: [short(row.handlerType), short(row.scope), short(row.trustStatus), row.enabled ? 'enabled' : 'disabled'].filter(Boolean).join(' · '),
      }))],
  ];
  return Promise.all(methods.map(async ([name, method, params, map]) => {
    try {
      const result = await rpc.request(method, params);
      return { name, rows: map(result), more: Boolean(result?.nextCursor) };
    } catch {
      return { name, rows: null, more: false };
    }
  }));
}

module.exports = { effective, models, rateLimits, readInventory };

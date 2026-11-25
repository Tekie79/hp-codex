'use strict';

const renderMarkdown = require('./render-markdown');
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const $all = selector => [...document.querySelectorAll(selector)];
const nav = $all('[data-tab]');
const prompt = byId('prompt');
const scroll = byId('scroll');
const model = byId('pickModel');
const effort = byId('pickEffort');
const mode = byId('pickMode');
const actions = $all('[data-action]');
const rendered = new Map();
const idleOnly = new Set(['connect', 'api', 'setKey', 'removeKey', 'changeFolder', 'skillToggle', 'new', 'login', 'logout', 'enablePlan', 'worktree', 'mcpReload', 'mcpLogin', 'revertHistory']);
const needsConnection = new Set(['changeFolder', 'new', 'history', 'historyMore', 'login', 'logout', 'cancelLogin', 'enablePlan',
  'older', 'attach', 'attachEditor', 'findFile', 'pickSkill', 'pickPlugin', 'appMention', 'skillToggle', 'inventory', 'mcpReload', 'mcpLogin', 'worktree', 'revertHistory']);
const commands = [
  ['new', 'New conversation'], ['review', 'Run native code review'], ['compact', 'Compact current conversation'],
  ['diff', 'Open the native turn diff'], ['status', 'Show execution and usage'], ['resume', 'Browse native conversations'],
  ['model', 'Choose a model'], ['plan', 'Choose native Plan mode'], ['worktree', 'Open official CLI worktree flow'],
];
let current;
let activeTab = 'conversation';
let pendingText;
let chatScroll = 0;
let historyRequested = false;
let inventoryRequested = false;
let olderRequested = false;
let identity;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

const count = value => Number.isFinite(value) ? value.toLocaleString() : 'Unavailable';
const status = value => ({ inProgress: 'In progress', pendingInit: 'Starting', notLoaded: 'Saved', unknown: 'Outcome unknown' })[value] || (value ? value[0].toUpperCase() + value.slice(1) : 'Unavailable');
const rxActive = new Set(['starting', 'running', 'stopping', 'unknown']);
const nearBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;

function selectTab(tab) {
  if (activeTab === 'conversation') chatScroll = scroll.scrollTop;
  activeTab = tab;
  for (const control of nav) {
    const key = control.dataset.tab;
    control.setAttribute('aria-pressed', String(key === tab));
    byId(key).hidden = key !== tab;
  }
  byId('composer').hidden = tab === 'settings' || tab === 'history';
  scroll.scrollTop = tab === 'conversation' ? chatScroll : 0;
  if (tab === 'history' && current?.connected && !historyRequested) {
    historyRequested = true;
    post('history', { archived: byId('archived').checked });
  }
  if (tab === 'settings' && current?.connected && !inventoryRequested) {
    inventoryRequested = true;
    post('inventory');
  }
  if (tab === 'execution') graph(current?.state.samples);
}

function post(type, fields) { vscode.postMessage({ type, ...fields }); }

function dispatch(type, extra) {
  if (type === 'send' || type === 'steer') {
    if (type === 'send' && runSlash()) return;
    const text = prompt.value;
    if (!text.trim() && !current?.attachments?.length) return;
    pendingText = text;
    post(type, { text, model: model.value, effort: effort.value, plan: mode.value });
  } else if (type === 'history') {
    post(type, { archived: byId('archived').checked });
  } else {
    if (type === 'older') olderRequested = true;
    post(type, extra);
  }
}

function runSlash(command) {
  if (!command) {
    const match = /^\/([a-z]+)\s*$/.exec(prompt.value);
    command = match?.[1];
  }
  if (!commands.some(([id]) => id === command)) return false;
  switch (command) {
    case 'status': selectTab('execution'); break;
    case 'resume': selectTab('history'); break;
    case 'model': model.focus(); break;
    case 'plan':
      if (!byId('modeSelect').hidden) mode.focus();
      else selectTab('settings');
      break;
    default: post(command);
  }
  prompt.value = '';
  commandSuggestions();
  return true;
}

function commandSuggestions() {
  const list = byId('slash');
  const entry = /^\/([a-z]*)$/.exec(prompt.value);
  const options = entry ? commands.filter(([id]) => id.startsWith(entry[1])) : [];
  list.replaceChildren(...options.map(([id, label]) => {
    const button = element('button', '/' + id + ' · ' + label, 'quiet');
    button.type = 'button';
    button.addEventListener('click', () => runSlash(id));
    return button;
  }));
  list.hidden = !options.length;
}

for (const button of nav) button.addEventListener('click', () => selectTab(button.dataset.tab));
for (const button of actions) button.addEventListener('click', () => dispatch(button.dataset.action));
byId('archived').addEventListener('change', () => dispatch('history'));
byId('filter').addEventListener('input', () => renderItems(current?.state.items || []));
prompt.addEventListener('input', commandSuggestions);
prompt.addEventListener('keydown', event => {
  if (event.key === 'Escape') byId('slash').hidden = true;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    const type = current?.state.status === 'running' ? 'steer' : 'send';
    if (!document.querySelector('[data-action="' + type + '"]').disabled) dispatch(type);
  }
});
byId('attentionAction').addEventListener('click', () => {
  if (current?.approval) post('approve', { id: current.approval });
  else post('reconcile');
});

function fillSelect(select, values, fallback) {
  const previous = select.value;
  const key = JSON.stringify(values);
  if (select.dataset.values === key) return;
  select.dataset.values = key;
  select.replaceChildren(element('option', fallback), ...values.map(({ value, label }) => {
    const option = element('option', label);
    option.value = value;
    return option;
  }));
  select.options[0].value = '';
  if (values.some(row => row.value === previous)) select.value = previous;
}

function updateEfforts() {
  const selected = current.models.find(row => row.id === (model.value || current.selected?.model || current.defaultModel));
  fillSelect(effort, (selected?.efforts || []).map(value => ({ value, label: status(value) })), 'Default effort');
}
model.addEventListener('change', () => {
  effort.value = '';
  updateEfforts();
});

function updateControls(data) {
  const { state, connected, busy, keySaved, recovery, login } = data;
  const active = rxActive.has(state.status) || recovery;
  for (const button of actions) {
    const key = button.dataset.action;
    let disabled = (busy && !['cloud', 'official'].includes(key)) || (needsConnection.has(key) && !connected) || (idleOnly.has(key) && (active || login));
    if (key === 'connect') disabled ||= connected && data.mode === 'native';
    if (key === 'api') disabled ||= !keySaved || (connected && data.mode === 'api');
    if (key === 'removeKey') disabled ||= !keySaved;
    if (key === 'send') { button.hidden = state.status === 'running'; disabled ||= !data.canRun || active || data.readOnly || login; }
    if (key === 'steer') { button.hidden = state.status !== 'running'; disabled ||= state.status !== 'running' || !data.canRun; }
    if (key === 'stop') { button.hidden = state.status !== 'running' && state.status !== 'stopping'; disabled ||= state.status !== 'running'; }
    if (key === 'diff') disabled ||= !state.diff;
    if (key === 'login' || key === 'logout') button.hidden = data.mode === 'api';
    if (key === 'cancelLogin') button.hidden = !login;
    if (key === 'enablePlan') button.hidden = data.experimental;
    if (key === 'revertHistory') disabled ||= !state.threadId || data.readOnly;
    if (key === 'older') button.hidden = !data.older;
    if (key === 'historyMore') button.hidden = !data.historyMore;
    button.disabled = Boolean(disabled);
  }
  fillSelect(model, data.models.map(row => ({ value: row.id, label: row.name })), 'Default model');
  updateEfforts();
  fillSelect(mode, data.modes.map(row => ({ value: row.mode, label: row.name || status(row.mode) })), 'Native mode');
  byId('modeSelect').hidden = !data.modes.length;
  for (const control of [model, effort, mode]) control.disabled = !connected || active || busy;
  byId('attention').hidden = !data.approval && !recovery;
  byId('attentionText').textContent = data.approval ? 'Codex is waiting for your decision.' : 'A previous turn needs reconciliation.';
  byId('attentionAction').textContent = data.approval ? 'Review request' : 'Reconcile';
  byId('attentionAction').disabled = !data.approval && busy;
}

function timer() {
  const state = current?.state;
  const ms = state?.durationMs ?? (state?.startedAt && ['starting', 'running', 'stopping'].includes(state.status) ? Date.now() - state.startedAt : null);
  const seconds = Math.max(0, Math.floor(ms / 1000));
  byId('elapsed').textContent = ms == null ? '' : Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
setInterval(timer, 1000);

function renderItems(items) {
  const match = byId('filter').value.toLowerCase();
  const available = new Set(items.map(item => item.id));
  for (const [id, value] of rendered) {
    if (!available.has(id)) { value.node.remove(); rendered.delete(id); }
  }
  const targets = new Map([[byId('chat'), []], [byId('activity'), []]]);
  for (const item of items) {
    const chat = ['userMessage', 'agentMessage', 'plan'].includes(item.type);
    const parent = byId(chat ? 'chat' : 'activity');
    let value = rendered.get(item.id);
    if (value && value.chat !== chat) { value.node.remove(); value = null; }
    if (!value) {
      const node = element(chat ? 'article' : 'details', undefined, chat ? 'message ' + item.type : 'expandable activity');
      const label = element(chat ? 'h3' : 'summary');
      const body = element(chat ? 'div' : 'pre', undefined, chat ? 'markdown' : 'output');
      node.append(label, body);
      value = { node, label, body, chat };
      rendered.set(item.id, value);
    }
    const elapsed = Number.isFinite(item.durationMs) ? ' · ' + (item.durationMs / 1000).toFixed(1) + ' s' : '';
    const label = chat ? item.label : item.label + ' · ' + status(item.status) + elapsed;
    if (value.label.textContent !== label) value.label.textContent = label;
    const detail = chat ? item.detail : [item.metadata, item.detail].filter(Boolean).join('\n\n');
    if (value.detail !== detail) {
      value.detail = detail;
      if (chat && item.type !== 'userMessage') value.body.innerHTML = renderMarkdown(detail || '');
      else value.body.textContent = detail || '';
    }
    value.node.hidden = !chat && !label.toLowerCase().includes(match) && !detail?.toLowerCase().includes(match);
    targets.get(parent).push(value.node);
  }
  for (const [parent, nodes] of targets) {
    nodes.forEach((node, index) => {
      if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null);
    });
  }
  byId('emptyActivity').hidden = targets.get(byId('activity')).some(node => !node.hidden);
  byId('welcome').hidden = Boolean(items.some(item => ['userMessage', 'agentMessage'].includes(item.type)));
}

function graph(samples) {
  const canvas = byId('graph');
  canvas.hidden = !samples?.length;
  if (canvas.hidden || activeTab !== 'execution') return;
  canvas.width = Math.max(1, canvas.clientWidth * (window.devicePixelRatio || 1));
  const context = canvas.getContext('2d');
  const max = Math.max(1, ...samples);
  const width = canvas.width / Math.max(14, samples.length);
  context.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-progressBar-background').trim() || '#388bfd';
  samples.forEach((sample, index) => {
    const height = Math.max(1, sample / max * canvas.height);
    context.fillRect((Math.max(14, samples.length) - samples.length + index) * width, canvas.height - height, Math.max(1, width - 3), height);
  });
}
new ResizeObserver(() => graph(current?.state.samples)).observe(byId('metrics'));

function pairs(target, rows) {
  target.replaceChildren(...rows.flatMap(([label, value]) => [element('dt', label), element('dd', value ?? 'Unavailable')]));
}

function renderUsage(data) {
  const { usage, samples } = data.state;
  const total = usage?.total;
  pairs(byId('metrics'), [
    ['Total', count(total?.totalTokens)], ['Input', count(total?.inputTokens)], ['Cached', count(total?.cachedInputTokens)],
    ['Output', count(total?.outputTokens)], ['Reasoning', count(total?.reasoningOutputTokens)], ['Latest', count(usage?.last?.totalTokens)],
  ]);
  graph(samples);
  const estimate = data.apiBilling?.estimate;
  const cost = Number.isFinite(estimate) ? new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6,
  }).format(estimate) + ' estimated response tokens' : 'Estimated cost unavailable';
  const quota = data.quota.map(row => [
    row.name + ' · ' + (row.minutes === null ? row.kind : row.minutes + ' min'),
    (row.percent == null ? 'Usage unavailable' : row.percent + '% used') + (row.reset ? ' · resets ' + new Date(row.reset * 1000).toLocaleString() : ''),
  ]);
  pairs(byId('quota'), [
    ['Context capacity', count(usage?.capacity)], ['Context occupancy', 'Unavailable'],
    ...(data.mode === 'api' ? [['The API bills confirmed runs', cost]] : quota.length ? quota : [['Subscription quota', 'Unavailable']]),
  ]);
}

function renderPlan(state) {
  const done = state.plan.filter(row => row.status === 'completed').length;
  byId('progressText').textContent = state.plan.length ? done + '/' + state.plan.length + (state.revisions > 1 ? ' · rev ' + state.revisions : '') : '';
  const progress = byId('planProgress');
  progress.hidden = !state.plan.length;
  progress.max = Math.max(1, state.plan.length);
  progress.value = done;
  byId('explanation').textContent = state.explanation || (state.plan.length ? '' : 'No checklist reported for this turn.');
  byId('plan').replaceChildren(...state.plan.map(row => {
    const li = element('li', undefined, row.status);
    li.append(element('span', row.status === 'completed' ? '✓' : row.status === 'inProgress' ? '◉' : '○', 'planMark'), element('span', row.step));
    li.firstChild.setAttribute('aria-label', status(row.status));
    return li;
  }));
}

function renderAgents(state) {
  const container = byId('agents');
  const open = new Set([...container.querySelectorAll('details[open]')].map(node => node.dataset.id));
  const nodes = new Map();
  const roots = [];
  for (const row of state.agents) {
    const details = element('details', undefined, 'expandable agent');
    details.dataset.id = row.id;
    details.open = open.has(row.id);
    const end = row.endedAt || (state.durationMs == null ? null : state.startedAt + state.durationMs);
    const timing = end && row.observedAt ? ' · observed ' + Math.max(0, Math.round((end - row.observedAt) / 1000)) + ' s' : '';
    details.append(element('summary', [row.name, row.role, status(row.status)].filter(Boolean).join(' · ') + timing));
    if (row.task) details.append(element('p', row.task));
    if (row.result) details.append(element('pre', row.result, 'output'));
    nodes.set(row.id, details);
  }
  for (const row of state.agents) {
    const details = nodes.get(row.id);
    const parent = nodes.get(row.parentId);
    if (parent && details !== parent && !details.contains(parent)) parent.append(details);
    else roots.push(details);
  }
  container.replaceChildren(...(roots.length ? roots : [element('p', 'No subagents reported for this turn.', 'secondary')]));
  byId('agentCount').textContent = roots.length ? String(state.agents.length) : '';
}

function smallButton(label, action, id, disabled) {
  const button = element('button', label, 'quiet');
  button.disabled = Boolean(disabled);
  button.addEventListener('click', () => post(action, { id }));
  return button;
}

function renderHistory(data) {
  byId('emptyHistory').textContent = data.history.length ? '' : data.connected ? 'No conversations loaded for this provider and workspace.' : 'Connect to browse native history.';
  const open = new Set([...byId('historyRows').querySelectorAll('details[open]')].map(node => node.dataset.id));
  const frozen = rxActive.has(data.state.status) || data.recovery || data.busy;
  byId('historyRows').replaceChildren(...data.history.map(row => {
    const details = element('details', undefined, 'expandable');
    details.dataset.id = row.id;
    details.open = open.has(row.id);
    details.append(element('summary', row.name));
    if (row.updatedAt) details.append(element('p', new Date(row.updatedAt * 1000).toLocaleString(), 'secondary'));
    const controls = element('div', undefined, 'actions');
    controls.append(smallButton('Read', 'viewThread', row.id, frozen));
    if (!data.archived) controls.append(smallButton('Resume', 'resume', row.id, frozen), smallButton('Fork', 'fork', row.id, frozen));
    controls.append(smallButton('Rename', 'rename', row.id, frozen),
      smallButton(data.archived ? 'Restore' : 'Archive', data.archived ? 'restore' : 'archive', row.id, frozen));
    details.append(controls);
    return details;
  }));
}

function renderSettings(data) {
  byId('version').textContent = data.version ? 'Codex ' + data.version : 'Runtime unavailable';
  byId('workspace').textContent = data.workspace || 'Unavailable';
  byId('billingMode').textContent = data.mode === 'api' ? 'Independent OpenAI Platform API' : 'Existing native Codex';
  byId('keyStatus').textContent = data.keySaved ? 'A key is stored in VS Code SecretStorage.' : 'No independent API key saved.';
  pairs(byId('config'), (data.settings || []).map(row => [row.name, [row.value || 'Native default', row.source].filter(Boolean).join(' · ')]));
  byId('inventoryEmpty').textContent = !data.inventory.length ? 'Refresh to inspect native integrations.' : '';
  const open = new Set([...byId('inventory').querySelectorAll('details[open]')].map(node => node.dataset.id));
  byId('inventory').replaceChildren(...data.inventory.map(group => {
    const details = element('details', undefined, 'expandable');
    details.dataset.id = group.name;
    details.open = open.has(group.name);
    details.append(element('summary', group.name + ' · ' + (group.rows ? group.rows.length + (group.more ? '+' : '') : 'unavailable')));
    for (const row of group.rows || []) {
      const item = element('div', undefined, 'inventoryItem');
      item.append(element('strong', row.name), element('p', row.detail || '', 'secondary'));
      if (row.children?.length) item.append(element('p', row.children.join(' · '), 'secondary'));
      details.append(item);
    }
    return details;
  }));
}

window.addEventListener('message', ({ data }) => {
  if (data?.openConversation) selectTab('conversation');
  if (data?.sent) {
    if (prompt.value === pendingText) prompt.value = '';
    pendingText = undefined;
    commandSuggestions();
  }
  if (!data?.state) return;
  const follow = nearBottom();
  const previousHeight = scroll.scrollHeight;
  const connectionKey = [data.workspace, data.provider, data.connected].join('/');
  if (current?.connectionKey !== connectionKey) { historyRequested = false; inventoryRequested = false; }
  data.connectionKey = connectionKey;
  const replaced = identity !== data.state.threadId;
  if (replaced) {
    identity = data.state.threadId;
    model.value = '';
    effort.value = '';
    mode.value = '';
  }
  current = data;
  const state = data.state;
  byId('connection').textContent = data.connected ? status(state.status) : data.connecting ? 'Connecting' : 'Disconnected';
  byId('signal').dataset.state = rxActive.has(state.status) ? state.status : data.connected ? 'connected' : 'disconnected';
  byId('account').textContent = data.mode === 'api' ? 'OpenAI API · billable' : [data.account?.type || 'Existing Codex', data.account?.plan].filter(Boolean).join(' · ');
  byId('model').textContent = [data.selected?.model || data.defaultModel || 'Model unavailable', data.selected?.effort || data.defaultEffort].filter(Boolean).join(' / ');
  byId('provider').textContent = data.mode === 'native' ? data.provider || '' : '';
  byId('notice').textContent = data.notice;
  byId('threadTitle').textContent = data.selected?.name || 'New conversation';
  byId('readOnly').hidden = !data.readOnly;
  byId('taskStatus').textContent = status(state.status);
  byId('turnError').textContent = state.error || '';
  byId('turnError').hidden = !state.error;
  byId('attachments').replaceChildren(...data.attachments.map(row => smallButton(row.label + ' ×', 'removeAttachment', row.id, data.busy)));
  byId('attachments').hidden = !data.attachments.length;
  updateControls(data);
  timer();
  renderItems(state.items);
  if (activeTab === 'conversation') {
    if (olderRequested && !data.busy) {
      scroll.scrollTop += Math.max(0, scroll.scrollHeight - previousHeight);
      olderRequested = false;
    } else if (replaced || follow) scroll.scrollTop = scroll.scrollHeight;
  }
  renderUsage(data);
  renderPlan(state);
  renderAgents(state);
  renderHistory(data);
  renderSettings(data);
  if (data.connected && !data.busy && activeTab === 'history' && !historyRequested) {
    historyRequested = true;
    dispatch('history');
  }
  if (data.connected && !data.busy && activeTab === 'settings' && !inventoryRequested) {
    inventoryRequested = true;
    dispatch('inventory');
  }
});

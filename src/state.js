'use strict';

const MAX_ITEMS = 240;
const MAX_TEXT = 16_000;
const terminal = new Set(['completed', 'failed', 'interrupted']);
const active = new Set(['starting', 'running', 'stopping', 'unknown']);
const clean = (value, length = MAX_TEXT) => typeof value === 'string' ? value.slice(0, length) : '';
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const list = value => Array.isArray(value) ? value : [];
function errorMessage(raw) {
  if (typeof raw !== 'string') return '';
  if (raw.startsWith('{') && raw.length <= 32_000) {
    try {
      const error = JSON.parse(raw);
      if (typeof error.error?.message === 'string') return clean(error.error.message, 2000);
    } catch { /* Unstructured native errors are already bounded. */ }
  }
  return clean(raw, 2000);
}

function newState() {
  return {
    threadId: null, turnId: null, status: 'idle', items: [], plan: [], explanation: '',
    revisions: 0, usage: null, samples: [], startedAt: null, durationMs: null,
    agents: [], diff: '', doneTurns: [], error: '',
  };
}

function upsert(rows, row, max = MAX_ITEMS) {
  const index = rows.findIndex(old => old.id === row.id);
  if (index < 0) rows.push(row);
  else rows[index] = row;
  if (rows.length > max) rows.shift();
}

function itemRow(item, turnId, done, previous) {
  const row = {
    id: item.id, turnId, type: item.type, label: clean(item.type, 80),
    detail: '', status: clean(item.status, 60) || (done ? 'completed' : 'in progress'),
    durationMs: number(item.durationMs), done,
  };
  switch (item.type) {
    case 'userMessage':
      row.label = 'You';
      row.detail = clean(list(item.content).slice(0, 24).map(part =>
        part.type === 'text' ? clean(part.text) : clean(part.name || (part.type === 'localImage' ? 'Image attachment' : part.type), 200)).join('\n'));
      break;
    case 'agentMessage': row.label = 'Codex'; row.detail = clean(item.text); break;
    case 'plan': row.label = 'Plan'; row.detail = clean(item.text); break;
    case 'reasoning':
      row.label = 'Reasoning summary';
      row.detail = clean(list(item.summary).slice(0, 40).map(part => clean(part)).join('\n'));
      break;
    case 'commandExecution': {
      const reported = list(item.commandActions).slice(0, 16);
      const operations = reported.map(action => ({ read: 'Read', listFiles: 'List', search: 'Search' })[action.type]).filter(Boolean);
      row.label = ([...new Set(operations)].join(' / ') || 'Command') + ' · ' + clean(item.command, 1000);
      row.detail = clean(item.aggregatedOutput);
      row.metadata = [
        clean(item.cwd, 600), clean(item.pluginId, 200),
        Number.isInteger(item.exitCode) ? 'Exit ' + item.exitCode : '',
      ].filter(Boolean).join(' · ');
      break;
    }
    case 'fileChange':
      row.label = 'File changes';
      row.detail = clean(list(item.changes).slice(0, 100).map(change =>
        clean(change.path, 1000) + '\n' + clean(change.diff)).join('\n'));
      break;
    case 'mcpToolCall':
      row.label = 'MCP · ' + clean(item.server, 150) + ' / ' + clean(item.tool, 150);
      row.detail = clean(item.error?.message) || clean(list(item.result?.content).slice(0, 24)
        .filter(part => part.type === 'text').map(part => clean(part.text)).join('\n'));
      row.metadata = clean(item.pluginId, 200);
      break;
    case 'dynamicToolCall': row.label = 'Tool · ' + clean(item.tool, 200); break;
    case 'collabAgentToolCall': row.label = 'Agents · ' + clean(item.tool, 100); row.detail = clean(item.prompt); break;
    case 'subAgentActivity': row.label = 'Agent · ' + clean(item.agentPath, 200); row.detail = clean(item.kind, 200); break;
    case 'webSearch': row.label = 'Web search'; row.detail = clean(item.query); break;
    case 'imageView': row.label = 'View image'; row.detail = clean(item.path); break;
    case 'contextCompaction': row.label = 'Context compacted'; break;
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      row.label = 'Code review'; row.detail = clean(item.review); break;
  }
  if (!row.detail && previous?.detail) row.detail = previous.detail;
  return row;
}

function updateAgents(state, item, turnId, now) {
  if (!['collabAgentToolCall', 'subAgentActivity'].includes(item.type)) return;
  const ids = item.type === 'subAgentActivity' ? [item.agentThreadId] : [
    ...list(item.receiverThreadIds), ...Object.keys(item.agentsStates || {}),
  ];
  for (const id of [...new Set(ids)].slice(0, 60)) {
    if (typeof id !== 'string' || id === state.threadId) continue;
    const previous = state.agents.find(agent => agent.id === id);
    const report = Object.hasOwn(item.agentsStates || {}, id) ? item.agentsStates[id] : null;
    const status = clean(report?.status, 60) || previous?.status || '';
    const ended = ['completed', 'errored', 'shutdown', 'notFound', 'interrupted'].includes(status);
    const parentId = clean(item.senderThreadId, 160) || previous?.parentId || state.threadId;
    upsert(state.agents, {
      id, parentId: parentId === id ? state.threadId : parentId,
      name: clean(item.agentPath, 180) || previous?.name || id,
      task: clean(item.prompt, 3000) || previous?.task || '',
      result: clean(report?.message, 3000) || previous?.result || '',
      status, turnId, observedAt: previous?.observedAt ?? now,
      endedAt: ended ? (previous?.endedAt ?? now) : null,
    }, 60);
  }
}

function applyItem(state, item, turnId, done, now, updateTree = true) {
  if (typeof item?.id !== 'string' || typeof item.type !== 'string') return;
  const previous = state.items.find(row => row.id === item.id);
  if ((previous?.done && !done) || (previous && previous.turnId !== turnId)) return;
  upsert(state.items, itemRow(item, turnId, done, previous));
  if (updateTree) updateAgents(state, item, turnId, now);
}

function applyTurn(state, turn, now = Date.now()) {
  if (typeof turn?.id !== 'string' || state.doneTurns.includes(turn.id)) return;
  if (state.turnId && turn.id !== state.turnId) return;
  state.turnId = turn.id;
  if (Number.isFinite(turn.startedAt)) state.startedAt = turn.startedAt * 1000;
  state.startedAt ??= now;
  if (terminal.has(turn.status)) {
    state.status = turn.status;
    state.doneTurns.push(turn.id);
    state.doneTurns = state.doneTurns.slice(-120);
    state.durationMs = number(turn.durationMs) ?? (Number.isFinite(turn.completedAt)
      ? Math.max(0, turn.completedAt * 1000 - state.startedAt) : Math.max(0, now - state.startedAt));
    state.error = errorMessage(turn.error?.message) || state.error;
  } else if (turn.status === 'inProgress' || !turn.status) {
    if (state.status !== 'stopping') state.status = 'running';
  } else state.status = 'unknown';
  for (const item of list(turn.items).slice(-MAX_ITEMS)) applyItem(state, item, turn.id, terminal.has(turn.status), now);
}

function hydrate(state, turns) {
  for (const turn of list(turns).slice(-50)) {
    if (typeof turn?.id !== 'string') continue;
    const done = terminal.has(turn.status);
    for (const item of list(turn.items).slice(-MAX_ITEMS)) applyItem(state, item, turn.id, done, 0, false);
    if (done && !state.doneTurns.includes(turn.id)) state.doneTurns.push(turn.id);
  }
}

function begin(state) {
  Object.assign(state, {
    status: 'starting', turnId: null, startedAt: Date.now(), durationMs: null,
    plan: [], revisions: 0, explanation: '', diff: '', error: '', agents: [],
  });
}

function event(state, method, params, now = Date.now()) {
  if (!params || !state.threadId || params.threadId !== state.threadId) return;
  const id = params.turnId || params.turn?.id;
  if (method === 'turn/started' || method === 'turn/completed') {
    if (state.doneTurns.includes(id)) return;
    const newTurn = id !== state.turnId;
    if (newTurn && method === 'turn/started' && !active.has(state.status)) begin(state);
    if (!state.turnId && ['starting', 'unknown'].includes(state.status)) state.turnId = id;
    if (id !== state.turnId) return;
    applyTurn(state, params.turn, now);
    return;
  }
  if (typeof id !== 'string' || id !== state.turnId) return;
  if (method === 'thread/tokenUsage/updated') {
    const usage = params.tokenUsage;
    if (!usage) return;
    const safe = value => Object.fromEntries(['totalTokens', 'inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens']
      .map(key => [key, number(value?.[key])]));
    const total = safe(usage.total);
    const last = safe(usage.last);
    const previous = state.usage?.total.totalTokens;
    if (previous != null && total.totalTokens != null && total.totalTokens < previous) return;
    if (last.totalTokens !== null && total.totalTokens !== null && total.totalTokens !== previous) {
      state.samples.push(last.totalTokens);
      if (state.samples.length > 64) state.samples.shift();
    }
    state.usage = { total, last, capacity: number(usage.modelContextWindow) };
    return;
  }
  if (method === 'item/completed') return applyItem(state, params.item, id, true, now, !terminal.has(state.status));
  if (terminal.has(state.status)) return;
  if (method === 'item/started') return applyItem(state, params.item, id, false, now);
  if (method === 'turn/diff/updated') { state.diff = clean(params.diff, 120_000); return; }
  if (method === 'error') { state.error = errorMessage(params.error?.message); return; }
  if (method === 'turn/plan/updated') {
    const plan = list(params.plan).slice(0, 100).map(step => ({ step: clean(step.step, 900), status: clean(step.status, 50) }));
    const explanation = clean(params.explanation, 1800);
    if (explanation !== state.explanation || JSON.stringify(plan) !== JSON.stringify(state.plan)) state.revisions++;
    state.plan = plan;
    state.explanation = explanation;
    return;
  }
  if (method === 'hook/started' || method === 'hook/completed') {
    const run = params.run;
    if (typeof run?.id !== 'string') return;
    const done = method === 'hook/completed';
    if (!done && state.items.some(row => row.id === 'hook:' + run.id && row.done)) return;
    upsert(state.items, {
      id: 'hook:' + run.id, turnId: id, type: 'hook', label: 'Hook · ' + clean(run.eventName, 100),
      status: clean(run.status, 60), detail: clean(run.statusMessage), done, durationMs: number(run.durationMs),
    });
    return;
  }
  const deltas = {
    'item/agentMessage/delta': ['agentMessage', 'Codex'],
    'item/plan/delta': ['plan', 'Plan'],
    'item/reasoning/summaryTextDelta': ['reasoning', 'Reasoning summary'],
    'item/commandExecution/outputDelta': ['commandExecution', 'Command'],
    'item/fileChange/outputDelta': ['fileChange', 'File changes'],
    'item/mcpToolCall/progress': ['mcpToolCall', 'MCP progress'],
  };
  if (!Object.hasOwn(deltas, method) || typeof params.itemId !== 'string') return;
  const [type, label] = deltas[method];
  let row = state.items.find(item => item.id === params.itemId);
  if (!row) {
    row = { id: params.itemId, turnId: id, type, label, detail: '', status: 'in progress', done: false };
    upsert(state.items, row);
  }
  if (!row.done && row.turnId === id) {
    const delta = params.delta ?? (typeof params.message === 'string' ? params.message + '\n' : '');
    row.detail = (row.detail + clean(delta)).slice(-MAX_TEXT);
  }
}

module.exports = { newState, event, begin, hydrate, applyTurn, terminal, active, clean, list, number };

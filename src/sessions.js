'use strict';

const path = require('node:path');
const { clean, list, terminal } = require('./state');

function checkThread(thread, cwd, provider) {
  if (typeof thread?.id !== 'string' || typeof thread.cwd !== 'string' || path.relative(cwd, thread.cwd)
    || thread.modelProvider !== provider || typeof provider !== 'string' || thread.parentThreadId) {
    throw Error('The native conversation belongs to a different workspace, provider, or agent');
  }
  return thread;
}

function brief(thread) {
  return {
    id: thread.id, name: clean(thread.name || thread.preview, 180) || 'Untitled conversation',
    updatedAt: Number.isFinite(thread.updatedAt) ? thread.updatedAt : null,
    status: clean(thread.status?.type, 40),
  };
}

async function historyPage(rpc, cwd, provider, archived, cursor) {
  const result = await rpc.request('thread/list', {
    cwd, modelProviders: [provider], sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown'],
    sortKey: 'updated_at', limit: 30, archived, cursor,
  });
  const rows = list(result?.data).flatMap(thread => {
    try { return [brief(checkThread(thread, cwd, provider))]; }
    catch { return []; }
  });
  return { rows, cursor: typeof result?.nextCursor === 'string' ? result.nextCursor : null };
}

async function readThread(rpc, id, cwd, provider) {
  const result = await rpc.request('thread/read', { threadId: id, includeTurns: false });
  const thread = checkThread(result?.thread, cwd, provider);
  if (thread.id !== id) throw Error('Codex returned an unexpected conversation');
  return thread;
}

async function itemPage(rpc, threadId, cursor) {
  const result = await rpc.request('thread/items/list', { threadId, sortDirection: 'desc', limit: 30, cursor });
  const turns = new Map();
  for (const entry of list(result?.data).reverse()) {
    if (typeof entry?.turnId !== 'string' || !entry.item) continue;
    let turn = turns.get(entry.turnId);
    if (!turn) {
      turn = { id: entry.turnId, status: 'completed', items: [] };
      turns.set(entry.turnId, turn);
    }
    turn.items.push(entry.item);
  }
  return { turns: [...turns.values()], cursor: typeof result?.nextCursor === 'string' ? result.nextCursor : null };
}

async function findTurn(rpc, threadId, turnId, clientId) {
  const { data } = await rpc.request('thread/turns/list', { threadId, limit: 6, itemsView: 'full', sortDirection: 'desc' });
  return list(data).find(turn => turnId ? turn.id === turnId : clientId
    && list(turn.items).some(item => item.type === 'userMessage' && item.clientId === clientId));
}

function isIdle(thread) {
  return ['idle', 'notLoaded'].includes(thread?.status?.type);
}

function isTerminal(turn) { return terminal.has(turn?.status); }

module.exports = { checkThread, brief, historyPage, readThread, itemPage, findTurn, isIdle, isTerminal };

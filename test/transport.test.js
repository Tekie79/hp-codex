'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const { access, mkdtemp, realpath, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { discover, Rpc, PROTOCOL_VERSION } = require('../src/native');
const { historyPage, findTurn, itemPage } = require('../src/sessions');

const configured = path.join(__dirname, 'fixtures', PROTOCOL_VERSION, 'codex');

async function connection(t, scenario = 'normal') {
  const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'hp-codex-fixture-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const env = { ...process.env, CODEX_HOME: path.join(cwd, 'native-home'), HP_FIXTURE_SCENARIO: scenario };
  const { spec, version } = await discover({ configured, cwd, env });
  const rpc = new Rpc(spec);
  t.after(() => rpc.close());
  const init = await rpc.request('initialize', { clientInfo: { name: 'hp_test', version: 'test' }, capabilities: null });
  rpc.notify('initialized');
  assert.equal(init.codexHome, env.CODEX_HOME);
  await assert.rejects(access(init.codexHome));
  assert.equal(version, PROTOCOL_VERSION);
  return { rpc, cwd, env };
}

test('versioned fake App Server preserves cwd and environment and correlates concurrent requests', async t => {
  const { rpc, cwd } = await connection(t);
  const [account, model, config, history] = await Promise.all([
    rpc.request('account/read', { refreshToken: false }), rpc.request('model/list', { limit: 5 }),
    rpc.request('config/read', { cwd }), historyPage(rpc, cwd, 'openai', false, null),
  ]);
  assert.equal(account.account.type, 'chatgpt');
  assert.equal(model.data[0].model, config.config.model);
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].id, 'fixture-saved');
});

test('turn lifecycle correlates native approval, usage, completion and history', async t => {
  const { rpc, cwd } = await connection(t);
  const { thread } = await rpc.request('thread/start', { cwd });
  const seen = [];
  const approval = [];
  rpc.on('request', request => {
    if (request.method === 'item/commandExecution/requestApproval') {
      approval.push(request);
      rpc.respond(request.id, { decision: 'decline' });
    } else rpc.reject(request.id);
  });
  const completed = new Promise(resolve => rpc.on('notification', message => {
    seen.push(message.method);
    if (message.method === 'turn/completed') resolve(message.params.turn);
  }));
  const start = await rpc.request('turn/start', {
    threadId: thread.id, clientUserMessageId: 'receipt', input: [{ type: 'text', text: 'Fixture', text_elements: [] }],
  });
  const final = await completed;
  assert.equal(approval.length, 1);
  assert.equal(approval[0].params.turnId, start.turn.id);
  assert.equal(final.status, 'completed');
  assert.ok(seen.includes('serverRequest/resolved'));
  assert.equal((await findTurn(rpc, thread.id, null, 'receipt')).id, final.id);
  assert.ok((await itemPage(rpc, thread.id)).turns[0].items.some(item => item.type === 'agentMessage'));
});

test('steering uses expected turn and interrupt reaches native terminal state', async t => {
  const { rpc, cwd } = await connection(t, 'hold');
  const { thread } = await rpc.request('thread/start', { cwd });
  const { turn } = await rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Fixture', text_elements: [] }] });
  const input = [{ type: 'text', text: 'Follow-up', text_elements: [] }];
  await assert.rejects(rpc.request('turn/steer', { threadId: thread.id, expectedTurnId: 'other', input }), { code: -32602 });
  assert.equal((await rpc.request('turn/steer', { threadId: thread.id, expectedTurnId: turn.id, input })).turnId, turn.id);
  const completion = new Promise(resolve => rpc.on('notification', message => {
    if (message.method === 'turn/completed') resolve(message.params.turn);
  }));
  await rpc.request('turn/interrupt', { threadId: thread.id, turnId: turn.id });
  assert.equal((await completion).status, 'interrupted');
});

for (const scenario of ['exit', 'timeout', 'malformed']) {
  test('transport reports uncertain delivery after ' + scenario, async t => {
    const { rpc, cwd } = await connection(t, scenario);
    const { thread } = await rpc.request('thread/start', { cwd });
    const pending = rpc.request('turn/start', { threadId: thread.id }, 150);
    await assert.rejects(pending, { uncertain: true });
    assert.equal(rpc.pending.size, 0);
    if (scenario !== 'timeout') {
      if (!rpc.closed) await once(rpc, 'closed');
      assert.equal(rpc.closed, true);
    }
  });
}

test('lost response can be reconciled through native history without another turn start', async t => {
  const { rpc, cwd } = await connection(t, 'lost-ack');
  const { thread } = await rpc.request('thread/start', { cwd });
  await assert.rejects(rpc.request('turn/start', { threadId: thread.id, clientUserMessageId: 'receipt',
    input: [{ type: 'text', text: 'Fixture', text_elements: [] }],
  }, 350), { uncertain: true });
  assert.equal((await findTurn(rpc, thread.id, null, 'receipt')).status, 'completed');
  const { data } = await rpc.request('thread/turns/list', { threadId: thread.id });
  assert.equal(data.length, 1);
});

test('unsupported runtimes fail before App Server initialization', async t => {
  const { cwd, env } = await connection(t);
  await assert.rejects(discover({ configured, cwd, env: { ...env, HP_FIXTURE_VERSION: '0.171.0-alpha.13.2' } }), /requires official Codex 0.155.1/);
});

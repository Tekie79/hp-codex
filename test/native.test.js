'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {launchSpec,newState,event}=require('../src/native');
const cwd=path.resolve('workspace');
test('preserves native home and environment without introducing a parallel profile',()=>{
  const env={CODEX_HOME:'/custom/native',PATH:'/bin',OPENAI_API_KEY:'synthetic-test-placeholder',CUSTOM_MCP:'fixture'};
  const s=launchSpec('codex',cwd,env);
  assert.deepEqual(s.options.env,env);assert.notEqual(s.options.env,env);assert.equal(s.options.cwd,cwd);
  assert.deepEqual(s.args,['app-server']);assert.equal(s.options.shell,false);
  assert.equal(Object.hasOwn(launchSpec('codex',cwd,{}).options.env,'CODEX_HOME'),false);
});
test('rejects relative executable and cwd',()=>{assert.throws(()=>launchSpec('./codex',cwd,{}));assert.throws(()=>launchSpec('codex','relative',{}));});
test('scope events, replace plan and deduplicate usage totals',()=>{
  const s=newState();s.threadId='t';
  event(s,'turn/started',{threadId:'t',turn:{id:'u'}},42);
  event(s,'turn/plan/updated',{threadId:'other',turnId:'u',plan:[{step:'wrong',status:'completed'}]});
  assert.equal(s.plan.length,0);
  event(s,'turn/plan/updated',{threadId:'t',turnId:'u',plan:[{step:'one',status:'pending'}]});
  event(s,'turn/plan/updated',{threadId:'t',turnId:'u',plan:[{step:'one',status:'completed'}]});
  assert.equal(s.plan[0].status,'completed');
  const usage={threadId:'t',turnId:'u',tokenUsage:{total:{totalTokens:12},last:{totalTokens:12}}};
  event(s,'thread/tokenUsage/updated',usage);event(s,'thread/tokenUsage/updated',usage);
  assert.deepEqual(s.samples,[12]);assert.equal(s.usage.capacity,null);
});
test('native final item replaces partial and ignores stale deltas',()=>{
  const s=newState();s.threadId='t';s.turnId='u';
  event(s,'item/agentMessage/delta',{threadId:'t',turnId:'u',itemId:'a',delta:'par'});
  event(s,'item/completed',{threadId:'t',turnId:'u',item:{id:'a',type:'agentMessage',text:'final'}});
  event(s,'item/agentMessage/delta',{threadId:'t',turnId:'u',itemId:'a',delta:'stale'});
  assert.equal(s.items[0].detail,'final');assert.equal(s.items[0].done,true);
  event(s,'turn/completed',{threadId:'t',turn:{id:'u',status:'completed'}});
  assert.equal(s.status,'completed');
});

test('ignore stale usage and terminal deltas, retain thread history, and expose only reasoning summaries', () => {
  const { begin } = require('../src/state');
  const state = newState();
  state.threadId = 'thread';
  begin(state);
  event(state, 'turn/started', { threadId: 'thread', turn: { id: 'first', status: 'inProgress' } }, 1);
  event(state, 'item/completed', {
    threadId: 'thread', turnId: 'first',
    item: { id: 'reason', type: 'reasoning', summary: ['public summary'], content: ['private content'] },
  });
  event(state, 'thread/tokenUsage/updated', {
    threadId: 'thread', turnId: 'first', tokenUsage: { total: { totalTokens: 10 }, last: { totalTokens: 10 } },
  });
  event(state, 'thread/tokenUsage/updated', {
    threadId: 'thread', turnId: 'first', tokenUsage: { total: { totalTokens: 9 }, last: { totalTokens: 9 } },
  });
  event(state, 'turn/completed', { threadId: 'thread', turn: { id: 'first', status: 'completed', durationMs: 125 } });
  event(state, 'turn/started', { threadId: 'thread', turn: { id: 'first', status: 'inProgress' } });
  assert.equal(state.status, 'completed');
  assert.equal(state.durationMs, 125);
  assert.deepEqual(state.samples, [10]);
  assert.equal(state.items[0].detail, 'public summary');
  assert.doesNotMatch(JSON.stringify(state), /private content/);
});

test('native subagent activity retains reported lifecycle status and observed timing', () => {
  const state = newState();
  state.threadId = 'parent';
  state.turnId = 'turn';
  state.status = 'running';
  const report = (id, kind, time) => event(state, 'item/completed', {
    threadId: 'parent', turnId: 'turn',
    item: { type: 'subAgentActivity', id, kind, agentThreadId: 'worker', agentPath: 'root/worker' },
  }, time);
  report('start', 'started', 100);
  assert.equal(state.agents[0].status, 'started');
  report('interaction', 'interacted', 150);
  assert.equal(state.agents[0].status, 'started');
  report('finish', 'completed', 200);
  assert.deepEqual(state.agents.map(agent => [agent.name, agent.status, agent.observedAt, agent.endedAt]), [
    ['root/worker', 'completed', 100, 200],
  ]);
});

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

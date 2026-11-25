'use strict';
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const path=require('node:path');

function launchSpec(executable,cwd,env=process.env){
  if(executable!=='codex'&&!path.isAbsolute(executable))throw Error('Use codex on PATH or a trusted absolute executable path');
  if(!path.isAbsolute(cwd))throw Error('Workspace path must be absolute');
  // Native configuration and authentication are authoritative: no overrides, no copies.
  return {executable,args:['app-server'],options:{cwd,env:{...env},shell:false,stdio:['pipe','pipe','pipe'],windowsHide:true}};
}
class Rpc extends EventEmitter{
  constructor(spec){
    super();this.pending=new Map();this.next=0;this.buffer='';this.closed=false;
    this.child=spawn(spec.executable,spec.args,spec.options);
    this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',c=>this.receive(c));
    this.child.stderr.resume(); // Raw output can contain credentials; never log it.
    this.child.stdin.on('error',()=>this.close('Codex input closed'));
    this.child.on('error',()=>this.close('Unable to launch existing Codex'));
    this.child.on('exit',()=>this.close('Codex disconnected; task outcome may be unknown'));
  }
  receive(c){
    if(this.closed)return;this.buffer+=c;
    let i;
    while((i=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i+1);
      if(line.length>8_000_000){this.close('Oversize native response');return;}
      if(!line.trim())continue;
      let m;try{m=JSON.parse(line);}catch{this.close('Invalid native response');return;}
      if(!m||typeof m!=='object'){this.close('Invalid native response');return;}
      if(typeof m.method==='string'){
        if(Object.hasOwn(m,'id'))this.send({id:m.id,error:{code:-32601,message:'Interactive requests not supported by this preview'}});
        else this.emit('notification',m);
      }else{
        const p=this.pending.get(m.id);if(!p)continue;
        this.pending.delete(m.id);clearTimeout(p.timer);
        if(m.error)p.reject(Error('Native request rejected: '+p.method));else p.resolve(m.result);
      }
    }
    if(this.buffer.length>8_000_000)this.close('Oversize native response');
  }
  send(m){if(this.closed)throw Error('Not connected');this.child.stdin.write(JSON.stringify(m)+'\n');}
  request(method,params={},ms=30_000){
    if(this.closed)return Promise.reject(Error('Not connected'));
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Native request timed out; outcome unknown: '+method));},ms);
      this.pending.set(id,{resolve,reject,timer,method});
      try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  notify(method){this.send({method});}
  close(reason='Connection closed'){
    if(this.closed)return;this.closed=true;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(reason));}
    this.pending.clear();this.buffer='';this.child.kill();this.emit('closed',reason);
  }
}
function clean(v){return typeof v==='string'?v.slice(0,12000):'';}
function newState(){return {threadId:null,turnId:null,status:'idle',items:[],plan:[],usage:null,samples:[],startedAt:null};}
function event(s,m,p,now=Date.now()){
  if(!p||!s.threadId||p.threadId!==s.threadId)return;
  const id=p.turnId||p.turn?.id;
  if(m==='turn/started'){
    if(typeof id!=='string'||(s.turnId&&s.turnId!==id&&s.status==='running'))return;
    if(s.turnId===id&&s.status==='running')return;
    s.turnId=id;s.status='running';s.startedAt=now;s.plan=[];return;
  }
  if(id&&s.turnId&&id!==s.turnId)return;
  if(m==='turn/completed'&&id===s.turnId){s.status=['completed','failed','interrupted'].includes(p.turn?.status)?p.turn.status:'unknown';return;}
  if(m==='turn/plan/updated'){s.plan=(Array.isArray(p.plan)?p.plan:[]).slice(0,100).map(x=>({step:clean(x.step),status:clean(x.status)}));return;}
  if(m==='thread/tokenUsage/updated'){
    const u=p.tokenUsage;
    if(!u)return;
    const safe=x=>Object.fromEntries(['totalTokens','inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens'].map(k=>[k,Number.isFinite(x?.[k])?x[k]:null]));
    const total=safe(u.total),last=safe(u.last);
    if(last.totalTokens!==null&&total.totalTokens!==null&&total.totalTokens!==s.usage?.total.totalTokens){s.samples.push(last.totalTokens);if(s.samples.length>60)s.samples.shift();}
    s.usage={total,last,capacity:Number.isFinite(u.modelContextWindow)?u.modelContextWindow:null};return;
  }
  if(m==='item/started'||m==='item/completed'){
    const i=p.item;if(typeof i?.id!=='string')return;
    const idx=s.items.findIndex(x=>x.id===i.id);
    if(idx>=0&&s.items[idx].done&&m==='item/started')return;
    let detail='';
    if(i.type==='agentMessage'||i.type==='plan')detail=clean(i.text);
    else if(i.type==='reasoning')detail=clean(Array.isArray(i.summary)?i.summary.join('\n'):'');
    else if(i.type==='commandExecution')detail=clean(i.aggregatedOutput);
    else if(i.type==='fileChange')detail=clean((Array.isArray(i.changes)?i.changes:[]).map(x=>clean(x.path)+'\n'+clean(x.diff)).join('\n'));
    else if(i.type==='webSearch')detail=clean(i.query);
    else if(i.type==='collabToolCall')detail=clean(i.tool);
    const row={id:i.id,label:clean(i.type)+(i.type==='commandExecution'?': '+clean(i.command):''),detail,status:clean(i.status)||(m==='item/completed'?'completed':'inProgress'),done:m==='item/completed'};
    if(idx<0)s.items.push(row);else s.items[idx]=row;
    if(s.items.length>200)s.items.shift();return;
  }
  const types={'item/agentMessage/delta':'Agent message','item/plan/delta':'Plan','item/reasoning/summaryTextDelta':'Reasoning summary','item/commandExecution/outputDelta':'Command'};
  if(types[m]&&typeof p.itemId==='string'){
    let row=s.items.find(x=>x.id===p.itemId);
    if(!row){row={id:p.itemId,label:types[m],detail:'',status:'inProgress',done:false};s.items.push(row);if(s.items.length>200)s.items.shift();}
    if(!row.done)row.detail=(row.detail+clean(p.delta)).slice(-12000);
  }
}
module.exports={launchSpec,Rpc,newState,event};

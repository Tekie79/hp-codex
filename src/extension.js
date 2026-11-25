'use strict';
const vscode=require('vscode');
const crypto=require('node:crypto');
const {launchSpec,Rpc,newState,event}=require('./native');
const {createRelay,validKey,providerSpec,verifyRoute,verifyRequirements}=require('./apiRelay');
const KEY_ID='hpCodex.independentOpenAiApiKey';

class Monitor{
  constructor(ctx){this.ctx=ctx;this.state=newState();this.account=null;this.rpc=null;this.view=null;this.busy=false;this.notice='Connect to existing Codex';this.mode='native';this.hasKey=false;this.relay=null;this.route=null;}
  resolveWebviewView(view){
    this.view=view;
    const root=vscode.Uri.joinPath(this.ctx.extensionUri,'media'),w=view.webview;
    w.options={enableScripts:true,localResourceRoots:[root]};
    const nonce=crypto.randomBytes(16).toString('base64');
    const css=w.asWebviewUri(vscode.Uri.joinPath(root,'monitor.css'));
    const js=w.asWebviewUri(vscode.Uri.joinPath(root,'monitor.js'));
    w.html='<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src '+w.cspSource+'; script-src \'nonce-'+nonce+'\';"><link rel="stylesheet" href="'+css+'"></head><body><header><h2>HP Codex</h2><p id="notice" role="status"></p><p id="account"></p><button id="connect">Connect existing Codex</button><button id="api">Connect HP API key</button><button id="setKey">Set/replace HP API key</button><button id="removeKey">Remove HP API key</button><p id="keyStatus"></p><button id="new">New task</button></header><section><h3>Usage</h3><p id="usage"></p><canvas id="graph" height="48"></canvas></section><section><h3>Execution plan <span id="progress"></span></h3><progress id="bar" max="1" value="0"></progress><ol id="plan"></ol></section><section><h3>Live activity <span id="status"></span></h3><div id="activity"></div></section><footer><textarea id="prompt" aria-label="Instructions" placeholder="Send instructions to native Codex"></textarea><button id="send">Send</button><button id="stop">Stop</button></footer><script nonce="'+nonce+'" src="'+js+'"></script></body></html>';
    w.onDidReceiveMessage(m=>void this.handle(m),undefined,this.ctx.subscriptions);
    view.onDidDispose(()=>{if(this.view===view)this.view=null;});this.publish();void this.readKeyStatus();
  }
  publish(){this.view?.webview.postMessage({notice:this.notice,account:this.account,mode:this.mode,hasKey:this.hasKey,busy:this.busy,connected:!!this.rpc&&!this.rpc.closed,state:this.state});}
  cwd(){
    const f=vscode.workspace.workspaceFolders;
    if(!vscode.workspace.isTrusted||!f||f.length!==1||f[0].uri.scheme!=='file'||vscode.env.remoteName)throw Error('Preview requires one trusted local workspace folder');
    return f[0].uri.fsPath;
  }
  async refresh(rpc){
    const r=await rpc.request('account/read',{refreshToken:false});
    if(this.rpc!==rpc)return;
    const a=r?.account;
    this.account=a?.type==='chatgpt'?{type:'ChatGPT',plan:typeof a.planType==='string'?a.planType:null}:a?.type==='apiKey'?{type:'API key'}:null;
  }
  async readKeyStatus(){try{this.hasKey=!!(await this.ctx.secrets.get(KEY_ID));}catch{this.hasKey=false;this.notice='HP API key storage unavailable';}this.publish();}
  ensureIdle(){if(['running','starting','stopping','unknown'].includes(this.state.status))throw Error('Finish or reconcile active task before switching credentials');}
  disconnect(){const old=this.rpc;this.rpc=null;this.account=null;this.relay?.close();this.relay=null;this.route=null;old?.close();this.state=newState();}
  async setKey(){this.ensureIdle();const key=await vscode.window.showInputBox({title:'HP Codex OpenAI API key',prompt:'Independent key; does not change native Codex login',password:true,ignoreFocusOut:true,validateInput:v=>validKey(v)?null:'Enter a valid nonempty API key without spaces'});if(key===undefined)return;if(!validKey(key))throw Error('Invalid API key format');if(this.mode==='api')this.disconnect();await this.ctx.secrets.store(KEY_ID,key);await this.readKeyStatus();this.notice='Independent HP API key saved';}
  async removeKey(){this.ensureIdle();const choice=await vscode.window.showWarningMessage('Remove the independently stored HP Codex key? Native Codex credentials will not change.',{modal:true},'Remove');if(choice!=='Remove')return;if(this.mode==='api')this.disconnect();await this.ctx.secrets.delete(KEY_ID);await this.readKeyStatus();this.notice='Independent HP API key removed';}
  async checkRoute(rpc){const r=await rpc.request('config/read',{includeLayers:false,cwd:this.cwd()});verifyRoute(r?.config,this.route.provider,this.relay.baseUrl,this.route.envKey);verifyRequirements(await rpc.request('configRequirements/read',{}));}
  async connect(mode='native'){
    if(this.rpc&&!this.rpc.closed&&this.mode===mode)return;
    this.ensureIdle();
    this.disconnect();this.mode=mode;
    if(this.state.status==='unknown')throw Error('Previous task outcome unknown. Reconcile in native Codex before starting another task.');
    let spec=launchSpec(vscode.workspace.getConfiguration('hpCodex').get('executable','codex'),this.cwd());
    if(mode==='api'){
      const key=await this.ctx.secrets.get(KEY_ID);if(!key)throw Error('Set an independent HP Codex API key first');
      const confirm=await vscode.window.showWarningMessage('Experimental independent API mode sends inference to api.openai.com through a local relay. Native login is unchanged. Do not use in managed environments. API charges apply only to confirmed turns.',{modal:true},'Connect');if(confirm!=='Connect')return;
      this.relay=await createRelay(key);this.route=providerSpec(spec,this.relay);spec=this.route.spec;
    }
    let rpc;try{rpc=new Rpc(spec);}catch(e){this.relay?.close();this.relay=null;this.route=null;throw e;}
    this.rpc=rpc;
    rpc.on('notification',m=>{
      if(this.rpc!==rpc)return;
      if(m.method==='account/updated'||m.method==='account/login/completed'){
        this.account=null;this.relay?.disarm();this.state.status='unknown';this.notice='Shared account changed; check native Codex before continuing';
      }else {event(this.state,m.method,m.params);if(m.method==='turn/completed'&&m.params?.threadId===this.state.threadId&&m.params?.turn?.id===this.state.turnId&&['completed','failed','interrupted','unknown'].includes(this.state.status))this.relay?.disarm();}
      this.publish();
    });
    rpc.on('closed',reason=>{
      if(this.rpc!==rpc)return;
      this.rpc=null;this.account=null;this.relay?.close();this.relay=null;this.route=null;
      if(['running','starting','stopping'].includes(this.state.status))this.state.status='unknown';
      this.notice=reason;this.publish();
    });
    try{
      await rpc.request('initialize',{clientInfo:{name:'hp_codex',title:'HP Codex',version:'0.0.2'}});
      rpc.notify('initialized');
      if(mode==='api'){await this.checkRoute(rpc);this.account={type:'HP OpenAI API key (unverified until successful inference)'};this.notice='Independent API preview connected; native account unchanged. Interactive approvals unavailable.';}else{await this.refresh(rpc);this.notice='Connected using existing native configuration. Interactive approvals are unavailable in this preview.';}
    }catch(e){rpc.close();throw e;}
  }
  async send(text){
    const rpc=this.rpc;
    if(!rpc||!this.account)throw Error('Connect with an existing supported Codex account first');
    if(['running','starting','stopping','unknown'].includes(this.state.status))throw Error('Wait for confirmed completion or stop the active turn');
    // Confirm every preview task: configured custom providers may differ from account metadata.
    const choice=await vscode.window.showWarningMessage(this.mode==='api'?'Run this task using your independently saved HP OpenAI API key? Standard API charges apply.':'Run with existing native Codex provider and settings? API or custom-provider usage may incur charges.',{modal:true},'Run');
    if(choice!=='Run'||this.rpc!==rpc||!this.account)return;
    try{
      if(this.mode==='api')await this.checkRoute(rpc);
      if(!this.state.threadId){
        const r=await rpc.request('thread/start',{cwd:this.cwd(),...(this.mode==='api'?{modelProvider:this.route.provider}:{})});
        if(this.mode==='api'&&r?.thread?.modelProvider!==this.route.provider)throw Error('Native thread provider mismatch; no paid request sent');
        if(typeof r?.thread?.id!=='string')throw Error('Thread ID missing');
        this.state.threadId=r.thread.id;
      }
      this.state.status='starting';this.state.turnId=null;this.publish();this.relay?.arm();
      const r=await rpc.request('turn/start',{threadId:this.state.threadId,input:[{type:'text',text}]});
      if(typeof r?.turn?.id!=='string')throw Error('Turn ID missing');
      if(this.state.status==='starting'){this.state.turnId=r.turn.id;this.state.status='running';this.state.startedAt=Date.now();}
    }catch(e){this.relay?.disarm();this.state.status='unknown';throw e;}
  }
  async handle(m){
    if(!m||typeof m!=='object'||this.busy)return;
    if(!['connect','api','setKey','removeKey','new','send','stop'].includes(m.type))return;
    this.busy=true;this.publish();
    try{
      if(m.type==='connect')await this.connect('native');
      if(m.type==='api')await this.connect('api');
      if(m.type==='setKey')await this.setKey();
      if(m.type==='removeKey')await this.removeKey();
      if(m.type==='new'){
        if(['running','starting','stopping','unknown'].includes(this.state.status))throw Error('Active or uncertain task must be reconciled first');
        this.state=newState();
      }
      if(m.type==='send'&&typeof m.text==='string'&&m.text.trim()&&m.text.length<=50000)await this.send(m.text.trim());
      if(m.type==='stop'&&this.rpc&&this.state.status==='running'&&this.state.turnId){
        this.state.status='stopping';this.publish();
        try{await this.rpc.request('turn/interrupt',{threadId:this.state.threadId,turnId:this.state.turnId});}
        catch(e){this.relay?.disarm();this.state.status='unknown';throw e;}
      }
    }catch(e){this.notice=typeof e.message==='string'?e.message:'Operation failed';}
    finally{this.busy=false;this.publish();}
  }
  dispose(){this.disconnect();}
}
function activate(ctx){const m=new Monitor(ctx);ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('hpCodex.monitor',m),m);}
module.exports={activate};

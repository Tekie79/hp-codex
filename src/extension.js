'use strict';
const vscode=require('vscode');
const crypto=require('node:crypto');
const {launchSpec,Rpc,newState,event}=require('./native');

class Monitor{
  constructor(ctx){this.ctx=ctx;this.state=newState();this.account=null;this.rpc=null;this.view=null;this.busy=false;this.notice='Connect to existing Codex';}
  resolveWebviewView(view){
    this.view=view;
    const root=vscode.Uri.joinPath(this.ctx.extensionUri,'media'),w=view.webview;
    w.options={enableScripts:true,localResourceRoots:[root]};
    const nonce=crypto.randomBytes(16).toString('base64');
    const css=w.asWebviewUri(vscode.Uri.joinPath(root,'monitor.css'));
    const js=w.asWebviewUri(vscode.Uri.joinPath(root,'monitor.js'));
    w.html='<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src '+w.cspSource+'; script-src \'nonce-'+nonce+'\';"><link rel="stylesheet" href="'+css+'"></head><body><header><h2>HP Codex</h2><p id="notice" role="status"></p><p id="account"></p><button id="connect">Connect existing Codex</button><button id="new">New task</button></header><section><h3>Usage</h3><p id="usage"></p><canvas id="graph" height="48"></canvas></section><section><h3>Execution plan <span id="progress"></span></h3><progress id="bar" max="1" value="0"></progress><ol id="plan"></ol></section><section><h3>Live activity <span id="status"></span></h3><div id="activity"></div></section><footer><textarea id="prompt" aria-label="Instructions" placeholder="Send instructions to native Codex"></textarea><button id="send">Send</button><button id="stop">Stop</button></footer><script nonce="'+nonce+'" src="'+js+'"></script></body></html>';
    w.onDidReceiveMessage(m=>void this.handle(m),undefined,this.ctx.subscriptions);
    view.onDidDispose(()=>{if(this.view===view)this.view=null;});this.publish();
  }
  publish(){this.view?.webview.postMessage({notice:this.notice,account:this.account,busy:this.busy,connected:!!this.rpc&&!this.rpc.closed,state:this.state});}
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
  async connect(){
    if(this.rpc&&!this.rpc.closed)return;
    if(this.state.status==='unknown')throw Error('Previous task outcome unknown. Reconcile in native Codex before starting another task.');
    const rpc=new Rpc(launchSpec(vscode.workspace.getConfiguration('hpCodex').get('executable','codex'),this.cwd()));
    this.rpc=rpc;
    rpc.on('notification',m=>{
      if(this.rpc!==rpc)return;
      if(m.method==='account/updated'||m.method==='account/login/completed'){
        this.account=null;this.state.status='unknown';this.notice='Shared account changed; check native Codex before continuing';
      }else event(this.state,m.method,m.params);
      this.publish();
    });
    rpc.on('closed',reason=>{
      if(this.rpc!==rpc)return;
      this.rpc=null;this.account=null;
      if(['running','starting','stopping'].includes(this.state.status))this.state.status='unknown';
      this.notice=reason;this.publish();
    });
    try{
      await rpc.request('initialize',{clientInfo:{name:'hp_codex',title:'HP Codex',version:'0.0.1'}});
      rpc.notify('initialized');
      await this.refresh(rpc);this.notice='Connected using existing native configuration. Interactive approvals are unavailable in this preview.';
    }catch(e){rpc.close();throw e;}
  }
  async send(text){
    const rpc=this.rpc;
    if(!rpc||!this.account)throw Error('Connect with an existing supported Codex account first');
    if(['running','starting','stopping','unknown'].includes(this.state.status))throw Error('Wait for confirmed completion or stop the active turn');
    // Confirm every preview task: configured custom providers may differ from account metadata.
    const choice=await vscode.window.showWarningMessage('Run with existing native Codex provider and settings? API or custom-provider usage may incur charges.',{modal:true},'Run');
    if(choice!=='Run'||this.rpc!==rpc||!this.account)return;
    try{
      if(!this.state.threadId){
        const r=await rpc.request('thread/start',{cwd:this.cwd()});
        if(typeof r?.thread?.id!=='string')throw Error('Thread ID missing');
        this.state.threadId=r.thread.id;
      }
      this.state.status='starting';this.state.turnId=null;this.publish();
      const r=await rpc.request('turn/start',{threadId:this.state.threadId,input:[{type:'text',text}]});
      if(typeof r?.turn?.id!=='string')throw Error('Turn ID missing');
      if(this.state.status==='starting'){this.state.turnId=r.turn.id;this.state.status='running';this.state.startedAt=Date.now();}
    }catch(e){this.state.status='unknown';throw e;}
  }
  async handle(m){
    if(!m||typeof m!=='object'||this.busy)return;
    if(!['connect','new','send','stop'].includes(m.type))return;
    this.busy=true;this.publish();
    try{
      if(m.type==='connect')await this.connect();
      if(m.type==='new'){
        if(['running','starting','stopping','unknown'].includes(this.state.status))throw Error('Active or uncertain task must be reconciled first');
        this.state=newState();
      }
      if(m.type==='send'&&typeof m.text==='string'&&m.text.trim()&&m.text.length<=50000)await this.send(m.text.trim());
      if(m.type==='stop'&&this.rpc&&this.state.status==='running'&&this.state.turnId){
        this.state.status='stopping';this.publish();
        try{await this.rpc.request('turn/interrupt',{threadId:this.state.threadId,turnId:this.state.turnId});}
        catch(e){this.state.status='unknown';throw e;}
      }
    }catch(e){this.notice=typeof e.message==='string'?e.message:'Operation failed';}
    finally{this.busy=false;this.publish();}
  }
  dispose(){this.rpc?.close();}
}
function activate(ctx){const m=new Monitor(ctx);ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('hpCodex.monitor',m),m);}
module.exports={activate};

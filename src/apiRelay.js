'use strict';
const http=require('node:http');
const https=require('node:https');
const crypto=require('node:crypto');
const {observeUsage}=require('./pricing');

const MAX_BODY=32*1024*1024, MAX_REQUESTS=100, MAX_CONCURRENT=8;
const ALLOWED=new Set(['/v1/responses','/v1/responses/compact']);
function validKey(key){return typeof key==='string'&&key.length>=12&&key.length<=2048&&/^[A-Za-z0-9_-]+$/.test(key);}
function providerSpec(executableSpec,relay){
  const provider='hp_codex_api_'+crypto.randomBytes(8).toString('hex');
  const envKey='HP_CODEX_RELAY_CAPABILITY';
  const prefix='model_providers.'+provider+'.';
  const values=[
    ['model_provider',provider],[prefix+'name','HP Codex API'],
    [prefix+'base_url',relay.baseUrl],[prefix+'env_key',envKey],
    [prefix+'wire_api','responses'],[prefix+'requires_openai_auth',false],
    [prefix+'supports_websockets',false],[prefix+'request_max_retries',0],[prefix+'stream_max_retries',0],
  ];
  const args=[...executableSpec.args];
  for(const [k,v] of values)args.push('-c',k+'='+JSON.stringify(v));
  return {provider,envKey,spec:{...executableSpec,args,options:{...executableSpec.options,env:{...executableSpec.options.env,[envKey]:relay.capability}}}};
}
function verifyRoute(config,provider,baseUrl,envKey){
  const p=config?.model_providers?.[provider];
  if(config?.model_provider!==provider||!p||p.base_url!==baseUrl||p.env_key!==envKey||p.requires_openai_auth!==false||p.wire_api!=='responses'||p.supports_websockets!==false||p.request_max_retries!==0||p.stream_max_retries!==0||p.auth||p.gateway_oauth||p.experimental_bearer_token)throw Error('Independent API provider could not be verified; no paid request sent');
}
// Native requirements RPC returns null for no managed constraints. Fail closed for any
// other shape in the preview; qualification will broaden known compatible policies.
function verifyRequirements(result){
  if(!result||!Object.hasOwn(result,'requirements')||result.requirements!==null)throw Error('Managed or unknown Codex requirements; independent API preview disabled');
}
function verifyCredentialIsolation(key,env){
  if(Object.values(env).some(value=>typeof value==='string'&&value.includes(key))){
    throw Error('The HP key is already present in the inherited environment. Use a separate key for independent mode.');
  }
}
function verifyDirectRouting(config, env){
  const proxy = Object.entries(env).some(([name,value]) => /^(https?_proxy|all_proxy|openai_base_url|openai_api_base|node_use_env_proxy)$/i.test(name) && value);
  if(proxy||config?.openai_base_url||config?.network||config?.model_provider&&config.model_provider!=='openai'
      ||config?.model_providers?.openai?.base_url||config?.forced_chatgpt_workspace_id||config?.forced_login_method){
    throw Error('Independent API mode requires an unmanaged direct OpenAI route');
  }
}
async function createRelay(key,{upstream=https.request,maxRequests=MAX_REQUESTS}={}){
  if(!validKey(key))throw Error('Invalid API key format');
  const capability=crypto.randomBytes(32).toString('hex');
  const expected=Buffer.from('Bearer '+capability);
  let armed=false,closed=false,count=0,active=0,generation=0,verified=false,priced=0,cost=0,billable=0,lastError=null;
  const requests=new Set(),clients=new Set();
  const server=http.createServer((req,res)=>{
    const reject=(code,message)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message}}));};
    const given=Buffer.from(typeof req.headers.authorization==='string'?req.headers.authorization:'');
    if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))return reject(401,'Unauthorized local relay request');
    if(!armed||closed)return reject(403,'No authorized API turn');
    if(req.headers.host!==server.address().address+':'+server.address().port||req.headers.origin)return reject(403,'Invalid local relay origin');
    if(req.method!=='POST'||!ALLOWED.has(req.url))return reject(404,'Unsupported API route');
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))return reject(415,'JSON required');
    if(count>=maxRequests||active>=MAX_CONCURRENT)return reject(429,'Local relay limit reached');
    const size=Number(req.headers['content-length']);
    if(Number.isFinite(size)&&size>MAX_BODY)return reject(413,'Request too large');
    const epoch=generation;
    count++;active++;clients.add(res);
    let finished=false,up,body=[],bytes=0;
    const done=()=>{if(finished)return;finished=true;body=[];active--;clients.delete(res);if(up)requests.delete(up);};
    res.once('close',()=>{if(up&&!res.writableFinished)up.destroy();done();});
    req.on('error',()=>{if(up)up.destroy();res.destroy();done();});
    req.on('data',chunk=>{
      if(finished)return;
      bytes+=chunk.length;
      if(bytes>MAX_BODY){body=[];reject(413,'Request too large');req.destroy();done();}else body.push(chunk);
    });
    req.on('end',()=>{
      if(finished||closed||!armed||epoch!==generation){if(!res.headersSent&&!res.destroyed)reject(403,'API turn closed');done();return;}
      const data=Buffer.concat(body);body=[];
      let input;
      try{input=JSON.parse(data.toString('utf8'));if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}catch{reject(400,'Invalid JSON');done();return;}
      try{
        billable++;
        up=upstream('https://api.openai.com'+req.url,{method:'POST',agent:false,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Length':data.length,Accept:'text/event-stream, application/json'}},incoming=>{
          if(finished||closed||!armed||epoch!==generation){incoming.destroy();return;}
          const status=incoming.statusCode||502;
          if(status<200||status>=300){lastError=status;incoming.resume();reject(status>=400&&status<=599?status:502,'OpenAI API request failed (HTTP '+status+')');done();return;}
          verified=true;
          const streaming=incoming.headers['content-type']?.startsWith('text/event-stream');
          res.writeHead(status,{'Content-Type':streaming?'text/event-stream':'application/json','Cache-Control':'no-store'});
          const observed=observeUsage(input,streaming,amount=>{if(amount!==null&&epoch===generation){priced++;cost+=amount;}});
          incoming.on('error',()=>{observed.destroy();res.destroy();done();});
          incoming.pipe(observed).pipe(res);
          incoming.once('end',done);
        });
        requests.add(up);
        up.on('error',()=>{if(!res.headersSent&&!res.destroyed)reject(502,'OpenAI API connection failed');else res.destroy();done();});
        up.setTimeout(300000,()=>up.destroy());
        up.end(data);
      }catch{if(!res.headersSent&&!res.destroyed)reject(502,'OpenAI API connection failed');else res.destroy();done();}
    });
  });
  server.maxConnections=24;
  server.setTimeout(310000,socket=>socket.destroy());
  server.on('checkContinue',(req,res)=>{res.writeHead(417,{'Connection':'close'});res.end();});
  server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=1000;
  server.on('clientError',(_,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  server.on('error',()=>{armed=false;});
  function disarm(){armed=false;generation++;for(const r of requests)r.destroy();for(const r of clients)r.destroy();requests.clear();clients.clear();}
  return {baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',capability,
    get verified(){return verified;},
    get billing(){return {estimate:billable>0&&billable===priced?cost:null,lastError};},
    arm(){if(closed||armed)throw Error('Relay unavailable or already armed');count=0;priced=0;cost=0;billable=0;lastError=null;armed=true;},
    disarm,
    close(){if(closed)return;closed=true;disarm();server.closeAllConnections?.();server.close();key='';}
  };
}
module.exports={createRelay,validKey,providerSpec,verifyRoute,verifyRequirements,verifyDirectRouting,verifyCredentialIsolation};

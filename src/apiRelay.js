'use strict';
const http=require('node:http');
const https=require('node:https');
const crypto=require('node:crypto');

const MAX_BODY=32*1024*1024, MAX_REQUESTS=100, MAX_CONCURRENT=8;
const ALLOWED=new Set(['/v1/responses','/v1/responses/compact']);
function validKey(key){return typeof key==='string'&&key.length>=12&&key.length<=2048&&!/\s/.test(key);}
function providerSpec(executableSpec,relay){
  const provider='hp_codex_api_'+crypto.randomBytes(8).toString('hex');
  const envKey='HP_CODEX_RELAY_CAPABILITY';
  const prefix='model_providers.'+provider+'.';
  const values=[
    ['model_provider',provider],[prefix+'name','HP Codex API'],
    [prefix+'base_url',relay.baseUrl],[prefix+'env_key',envKey],
    [prefix+'wire_api','responses'],[prefix+'requires_openai_auth',false],
    [prefix+'supports_websockets',false],
  ];
  const args=[...executableSpec.args];
  for(const [k,v] of values)args.push('-c',k+'='+JSON.stringify(v));
  return {provider,envKey,spec:{...executableSpec,args,options:{...executableSpec.options,env:{...executableSpec.options.env,[envKey]:relay.capability}}}};
}
function verifyRoute(config,provider,baseUrl,envKey){
  const p=config?.model_providers?.[provider];
  if(config?.model_provider!==provider||!p||p.base_url!==baseUrl||p.env_key!==envKey||p.requires_openai_auth!==false||p.wire_api!=='responses'||p.supports_websockets!==false||p.auth||p.gateway_oauth||p.experimental_bearer_token)throw Error('Independent API provider could not be verified; no paid request sent');
}
// Native requirements RPC returns null for no managed constraints. Fail closed for any
// other shape in the preview; qualification will broaden known compatible policies.
function verifyRequirements(result){
  if(!result||!Object.hasOwn(result,'requirements')||result.requirements!==null)throw Error('Managed or unknown Codex requirements; independent API preview disabled');
}
async function createRelay(key,{upstream=https.request,maxRequests=MAX_REQUESTS}={}){
  if(!validKey(key))throw Error('Invalid API key format');
  const capability=crypto.randomBytes(32).toString('hex');
  const expected=Buffer.from('Bearer '+capability);
  let armed=false,closed=false,count=0,active=0;
  const requests=new Set(),clients=new Set();
  const server=http.createServer((req,res)=>{
    const reject=(code,message)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message}}));};
    const given=Buffer.from(typeof req.headers.authorization==='string'?req.headers.authorization:'');
    if(given.length!==expected.length||!crypto.timingSafeEqual(given,expected))return reject(401,'Unauthorized local relay request');
    if(!armed||closed)return reject(403,'No authorized API turn');
    if(req.method!=='POST'||!ALLOWED.has(req.url))return reject(404,'Unsupported API route');
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return reject(415,'JSON required');
    if(count>=maxRequests||active>=MAX_CONCURRENT)return reject(429,'Local relay limit reached');
    count++;active++;clients.add(res);
    let finished=false,up,body=[],bytes=0;
    const done=()=>{if(finished)return;finished=true;active--;clients.delete(res);if(up)requests.delete(up);};
    res.once('close',()=>{if(up&&!res.writableFinished)up.destroy();done();});
    req.on('error',()=>{if(up)up.destroy();res.destroy();done();});
    req.on('data',chunk=>{
      if(finished)return;
      bytes+=chunk.length;
      if(bytes>MAX_BODY){body=[];reject(413,'Request too large');req.destroy();done();}else body.push(chunk);
    });
    req.on('end',()=>{
      if(finished||closed||!armed){if(!res.headersSent&&!res.destroyed)reject(403,'API turn closed');done();return;}
      const data=Buffer.concat(body);body=[];
      try{JSON.parse(data.toString('utf8'));}catch{reject(400,'Invalid JSON');done();return;}
      try{
        up=upstream('https://api.openai.com'+req.url,{method:'POST',agent:false,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Content-Length':data.length,Accept:'text/event-stream, application/json'}},incoming=>{
          const status=incoming.statusCode||502;
          if(status<200||status>=300){incoming.resume();reject(status>=400&&status<=599?status:502,'OpenAI API request failed (HTTP '+status+')');done();return;}
          res.writeHead(status,{'Content-Type':incoming.headers['content-type']||'application/json','Cache-Control':'no-store'});
          incoming.on('error',()=>{res.destroy();done();});incoming.pipe(res);
          incoming.once('end',done);
        });
        requests.add(up);
        up.on('error',()=>{if(!res.headersSent&&!res.destroyed)reject(502,'OpenAI API connection failed');else res.destroy();done();});
        up.setTimeout(300000,()=>up.destroy());
        up.end(data);
      }catch{if(!res.headersSent&&!res.destroyed)reject(502,'OpenAI API connection failed');else res.destroy();done();}
    });
  });
  server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=1000;
  server.on('clientError',(_,socket)=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  server.on('error',()=>{armed=false;});
  function disarm(){armed=false;for(const r of requests)r.destroy();for(const r of clients)r.destroy();requests.clear();clients.clear();}
  return {baseUrl:'http://127.0.0.1:'+server.address().port+'/v1',capability,
    arm(){if(closed||armed)throw Error('Relay unavailable or already armed');count=0;armed=true;},
    disarm,
    close(){if(closed)return;closed=true;disarm();server.closeAllConnections?.();server.close();key='';}
  };
}
module.exports={createRelay,validKey,providerSpec,verifyRoute,verifyRequirements};

'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const {createRelay,providerSpec,verifyRoute,verifyRequirements}=require('../src/apiRelay');
const {launchSpec}=require('../src/native');
const path=require('node:path');

test('independent provider passes only temporary capability, preserves native home and never changes existing key',()=>{
  const env={CODEX_HOME:'/native/custom',OPENAI_API_KEY:'native-fixture-key'};
  const relay={baseUrl:'http://127.0.0.1:12345/v1',capability:'temporary-capability'};
  const route=providerSpec(launchSpec('codex',path.resolve('.'),env),relay);
  assert.equal(route.spec.options.env.CODEX_HOME,env.CODEX_HOME);
  assert.equal(route.spec.options.env.OPENAI_API_KEY,env.OPENAI_API_KEY);
  assert.equal(route.spec.options.env[route.envKey],relay.capability);
  assert.equal(Object.hasOwn(env,route.envKey),false);
  assert.ok(route.spec.args.includes('model_provider='+JSON.stringify(route.provider)));
  assert.ok(route.spec.args.includes('model_providers.'+route.provider+'.requires_openai_auth=false'));
  const p={base_url:relay.baseUrl,env_key:route.envKey,requires_openai_auth:false,wire_api:'responses',supports_websockets:false};
  const config={model_provider:route.provider,model_providers:{[route.provider]:p}};
  assert.doesNotThrow(()=>verifyRoute(config,route.provider,relay.baseUrl,route.envKey));
  assert.throws(()=>verifyRoute({...config,model_provider:'openai'},route.provider,relay.baseUrl,route.envKey));
  assert.doesNotThrow(()=>verifyRequirements({requirements:null}));
  assert.throws(()=>verifyRequirements({requirements:{allowedModelProviders:['openai']}}));
  assert.throws(()=>verifyRequirements({}));
});
test('relay rejects unapproved and unsupported requests, injects only its own key into fixed upstream, and stops after disarm',async()=>{
  const calls=[];
  const upstream=(url,options,cb)=>{
    const request=new EventEmitter();
    request.setTimeout=()=>{};request.destroy=()=>{};
    request.end=data=>{
      calls.push({url,options,body:JSON.parse(data.toString())});
      const incoming=Readable.from(['data: synthetic\n\n']);incoming.statusCode=200;incoming.headers={'content-type':'text/event-stream'};
      cb(incoming);
    };
    return request;
  };
  const key='synthetic-independent-api-key';
  const relay=await createRelay(key,{upstream,maxRequests:1});
  const post=(p,token=relay.capability)=>fetch(relay.baseUrl+p,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model:'fixture',input:'test'})});
  try{
    assert.equal((await post('/responses')).status,403);
    relay.arm();
    assert.equal((await post('/responses','invalid')).status,401);
    assert.equal((await post('/files')).status,404);
    const r=await post('/responses');assert.equal(r.status,200);assert.equal(await r.text(),'data: synthetic\n\n');
    assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
    assert.equal(calls[0].options.headers.Authorization,'Bearer '+key);
    assert.equal((await post('/responses')).status,429);
    relay.disarm();assert.equal((await post('/responses')).status,403);
  }finally{relay.close();}
});

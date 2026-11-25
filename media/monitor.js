'use strict';
const vs=acquireVsCodeApi(),$=id=>document.getElementById(id);
let snapshot;
for(const id of ['connect','new','stop'])$(id).addEventListener('click',()=>vs.postMessage({type:id}));
$('send').addEventListener('click',()=>{const text=$('prompt').value;if(text.trim())vs.postMessage({type:'send',text});});
function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
function tokens(n){return Number.isFinite(n)?n.toLocaleString():'—';}
const rows=new Map();
window.addEventListener('message',({data:d})=>{
  if(!d?.state)return;snapshot=d;const s=d.state;
  $('notice').textContent=d.notice||'';
  $('account').textContent=d.account?'Existing account: '+d.account.type+(d.account.plan?' · '+d.account.plan:''):'Account unavailable';
  $('status').textContent=s.status;
  const active=['starting','running','stopping','unknown'].includes(s.status);
  $('connect').disabled=d.busy||d.connected;$('new').disabled=d.busy||!d.connected||active;$('send').disabled=d.busy||!d.connected||!d.account||active;$('stop').disabled=d.busy||!d.connected||s.status!=='running';
  const u=s.usage;
  $('usage').textContent=u?'Total '+tokens(u.total.totalTokens)+' · Input '+tokens(u.total.inputTokens)+' · Cache '+tokens(u.total.cachedInputTokens)+' · Output '+tokens(u.total.outputTokens)+' · Context capacity '+tokens(u.capacity):'Usage unavailable';
  const canvas=$('graph');canvas.width=Math.max(1,canvas.clientWidth);const g=canvas.getContext('2d'),values=s.samples,max=Math.max(1,...values);
  g.fillStyle=getComputedStyle(document.body).color;
  const step=canvas.width/Math.max(30,values.length);
  values.forEach((v,i)=>g.fillRect(i*step,canvas.height-v/max*canvas.height,Math.max(1,step-2),v/max*canvas.height));
  const done=s.plan.filter(x=>x.status==='completed').length;
  $('progress').textContent=done+'/'+s.plan.length;$('bar').max=Math.max(1,s.plan.length);$('bar').value=done;
  $('plan').replaceChildren(...s.plan.map(x=>node('li',(x.status==='completed'?'✓ ':x.status==='inProgress'?'◉ ':'○ ')+x.step)));
  const current=new Set(s.items.map(x=>x.id));
  for(const [id,row] of rows)if(!current.has(id)){row.remove();rows.delete(id);}
  for(const item of s.items){
    let row=rows.get(item.id);
    if(!row){row=node('details','');row.append(node('summary',''),node('pre',''));rows.set(item.id,row);$('activity').append(row);}
    row.firstChild.textContent=item.label+' · '+item.status;row.lastChild.textContent=item.detail||'No displayable detail';
  }
});

'use strict';
// 部署時自行替換；繳交副本維持假值，勿填入員工密碼。
const API_URL = 'https://script.google.com/macros/s/AKfycbzmELsJUZmzHoSU-JuVO_mnOe_mKENJuyfbK3PpvbiCY9FK8-up4tpj4kBIgfTKBLp_/exec';
const TICKET_KEY = 'ntou-waitlist-ticket-v1';
const $ = id => document.getElementById(id);
const message = text => { $('message').textContent = text; };
async function api(action, data={}) {
  if (API_URL.includes('REPLACE_WITH_DEPLOYMENT_ID')) throw new Error('尚未設定後端網址，請依部署說明設定。');
  let response;
  try { response = await fetch(API_URL, {method:'POST',body:JSON.stringify({action,...data}),redirect:'follow'}); }
  catch (_) { throw new Error('無法連線；操作結果可能尚未確認，請先查看狀態再重試。'); }
  if (!response.ok) throw new Error('伺服器回應錯誤，請稍後再試。');
  let result; try { result=await response.json(); } catch (_) { throw new Error('後端回應格式錯誤，請檢查部署與授權。'); }
  if (!result.ok) throw new Error(result.error || '操作失敗');
  return result;
}
async function count() {
  if (API_URL.includes('REPLACE_WITH_DEPLOYMENT_ID')) {message('尚未設定後端網址，請依部署說明設定。');return;}
  try { const r=await fetch(API_URL+'?action=count'); const j=await r.json(); if (!j.ok) throw Error(); $('count').textContent=j.count; }
  catch (_) { $('count').textContent='—'; message('目前無法更新候位數，請檢查連線。'); }
}
function ticketRead(){try{return JSON.parse(localStorage.getItem(TICKET_KEY)||'null')}catch(_){return null}}
function ticketSave(t){localStorage.setItem(TICKET_KEY,JSON.stringify(t));}
function ticketView(t){$('join-card').hidden=!!t; $('ticket').hidden=!t; if(t) $('ticket-id').textContent=t.id;}
async function customerStatus(){
  const t=ticketRead(); if(!t)return;
  try {const r=await api('status',t); $('ahead').textContent=r.ahead; $('count').textContent=r.count; $('status').textContent=r.status==='notified'?'已通知':'等候中'; $('forget').hidden=true;}
  catch(e){message(e.message); if(e.message.includes('找不到候位')) {$('status').textContent='已結束或票證無效'; $('forget').hidden=false; $('cancel-self').disabled=true;}}
}
async function withButton(button,fn){button.disabled=true;try{await fn()}catch(e){message(e.message)}finally{button.disabled=false}}
if(document.body.dataset.page==='customer'){
  ticketView(ticketRead()); count(); customerStatus(); setInterval(()=>{count();customerStatus()},5000);
  $('join-form').addEventListener('submit',e=>{e.preventDefault(); const form=e.currentTarget; withButton(form.querySelector('button'),async()=>{message(''); const f=new FormData(form); const r=await api('join',{name:f.get('name'),gender:f.get('gender'),email:f.get('email'),partySize:Number(f.get('partySize'))}); try{ticketSave({id:r.id,token:r.token})}catch(_){message('已取得號碼，但瀏覽器無法保存票證；請聯絡員工。');return} ticketView(ticketRead()); $('ahead').textContent=r.ahead; $('count').textContent=r.count; $('status').textContent='等候中'; message('已加入候位。');});});
  $('cancel-self').addEventListener('click',()=>{if(!confirm('確定取消您的候位？'))return; withButton($('cancel-self'),async()=>{const t=ticketRead();await api('cancelSelf',t);localStorage.removeItem(TICKET_KEY);ticketView(null);message('已取消候位。');count();});});
  $('forget').addEventListener('click',()=>{localStorage.removeItem(TICKET_KEY);ticketView(null);$('cancel-self').disabled=false;message('已清除本機票證。');});
}else{
  let key='', busy=false;
  function clearDashboard(){key='';$('dashboard').hidden=true;$('login-card').hidden=false;$('rows').replaceChildren();$('stats').replaceChildren();$('log').textContent='';$('login-form').reset();}
  function cell(row,value){const td=document.createElement('td');td.textContent=value;row.append(td);return td;}
  async function refresh(){if(!key||busy)return; busy=true;try{const [q,s]=await Promise.all([api('queue',{key}),api('stats',{key})]);if(!key)return;const rows=$('rows');rows.replaceChildren(); q.items.forEach(it=>{const tr=document.createElement('tr'); [it.id,it.name,it.gender,it.partySize,it.email,new Date(it.createdAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}),it.status==='notified'?'已通知':'等候中'].forEach(v=>cell(tr,v));const td=cell(tr,'');[['通知','notify'],['入座','seat'],['取消','cancel']].forEach(([label,action])=>{const btn=document.createElement('button');btn.className='secondary';btn.textContent=label;btn.disabled=action==='notify'&&it.status==='notified';btn.addEventListener('click',()=>act(action,it.id,btn));td.append(btn)});rows.append(tr)}); $('empty').hidden=q.items.length>0; const stat=$('stats');stat.replaceChildren(); [['目前候位',s.current+' 組'],['今日取號',s.todayJoined+' 組'],['今日入座',s.seated+' 組'],['平均等候',s.averageWaitMinutes===null?'—':s.averageWaitMinutes.toFixed(1)+' 分'],['放棄率',s.abandonmentRate===null?'—':(100*s.abandonmentRate).toFixed(1)+'%']].forEach(([label,value])=>{const box=document.createElement('div'), strong=document.createElement('strong');box.className='stat';box.textContent=label;strong.textContent=value;box.append(strong);stat.append(box)});}
  catch(e){message(e.message);if(e.message.includes('員工密碼'))clearDashboard()}finally{busy=false}}
  async function act(action,id,button){if(!confirm(`確定對 ${id} 號執行「${{notify:'通知',seat:'入座',cancel:'取消'}[action]}」？`))return;await withButton(button,async()=>{await api(action,{key,id});message('操作完成。');await refresh()});}
  $('login-form').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;withButton(form.querySelector('button'),async()=>{const candidate=new FormData(form).get('key');await api('queue',{key:candidate});key=candidate;form.reset();$('login-card').hidden=true;$('dashboard').hidden=false;message('');await refresh()})});
  $('logout').addEventListener('click',()=>{clearDashboard();message('已登出。')});$('refresh').addEventListener('click',refresh);$('show-log').addEventListener('click',()=>withButton($('show-log'),async()=>{$('log').textContent=JSON.stringify((await api('log',{key})).events,null,2)}));setInterval(refresh,5000);
}

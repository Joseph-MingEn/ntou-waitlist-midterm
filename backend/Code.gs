/* 候位系統：Script Properties 的 STAFF_KEY 由擁有者自行設定。 */
const MAX_QUEUE = 300;
const LOG_LIMIT = 60;
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function error_(message) { return {ok:false, error:message}; }
function doGet(e) {
  if (!e || !e.parameter || e.parameter.action !== 'count') return json_(error_('不支援的操作'));
  return locked_(function(p) { return {ok:true,count:read_(p,'queue',[]).length}; });
}
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(); }
  catch (_) { return json_(error_('無效的請求')); }
  return locked_(function(p) { return dispatch_(p, body); });
}
function locked_(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); return json_(fn(PropertiesService.getScriptProperties())); }
  catch (_) { return json_(error_('服務暫時無法完成操作；如剛通知，請先確認信箱再重試')); }
  finally { try { lock.releaseLock(); } catch (_) {} }
}
function read_(p,k,fallback) { const v=p.getProperty(k); return v ? JSON.parse(v) : fallback; }
function today_(date) { return Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd'); }
function stat_(p,day) { return read_(p,'stats:'+day,{joined:0,seated:0,cancelled:0,waitMs:0}); }
function log_(p,event,id,at) {
  const entries=read_(p,'events',[]); entries.push({time:at,action:event,id:id});
  return JSON.stringify(entries.slice(-LOG_LIMIT));
}
function auth_(p,key) { const actual=p.getProperty('STAFF_KEY'); return !!actual && actual !== 'CHANGE_ME' && typeof key === 'string' && key === actual; }
function item_(p,id) { return read_(p,'item:'+id,null); }
function validId_(id) { return Number.isSafeInteger(id) && id > 0; }
function dispatch_(p,b) {
  const action=b.action, q=read_(p,'queue',[]), now=new Date(), at=now.toISOString(), day=today_(now);
  const staff=['queue','stats','log','notify','seat','cancel','reset'];
  if (staff.indexOf(action)!==-1 && !auth_(p,b.key)) return error_('員工密碼錯誤或尚未設定');
  if (action==='join') {
    const name=typeof b.name==='string'?b.name.trim():'';
    const gender=typeof b.gender==='string'?b.gender.trim():'';
    const email=typeof b.email==='string'?b.email.trim():'';
    if (!name || name.length>60 || !gender || gender.length>20 || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Number.isInteger(b.partySize) || b.partySize<1 || b.partySize>20) return error_('請正確填寫姓名、性別、電子郵件及 1–20 位人數');
    if (q.length>=MAX_QUEUE) return error_('目前候位已滿');
    const id=Number(p.getProperty('next_id') || 1);
    if (!validId_(id) || !Number.isSafeInteger(id+1)) return error_('號碼已達上限');
    const token=Utilities.getUuid()+Utilities.getUuid();
    const item={id:id,token:token,name:name,gender:gender,email:email,partySize:b.partySize,status:'waiting',createdAt:at,notifiedAt:''};
    const s=stat_(p,day); s.joined++; q.push(id);
    const writes={queue:JSON.stringify(q),next_id:String(id+1),events:log_(p,'join',id,at)};
    writes['item:'+id]=JSON.stringify(item); writes['stats:'+day]=JSON.stringify(s); p.setProperties(writes);
    return {ok:true,id:id,token:token,ahead:q.length-1,count:q.length,status:'waiting'};
  }
  if (action==='status' || action==='cancelSelf') {
    if (!validId_(b.id)) return error_('找不到候位或票證無效');
    const it=item_(p,b.id), pos=q.indexOf(b.id);
    if (!it || pos<0 || typeof b.token!=='string' || b.token!==it.token) return error_('找不到候位或票證無效');
    if (action==='status') return {ok:true,id:it.id,status:it.status,ahead:pos,count:q.length};
    return remove_(p,q,it,'cancel',at,now);
  }
  if (action==='queue') return {ok:true,items:q.map(function(id){const it=item_(p,id); if (!it) throw Error('資料不一致'); delete it.token; return it;})};
  if (action==='stats') { const s=stat_(p,day); return {ok:true,day:day,todayJoined:s.joined,seated:s.seated,cancelled:s.cancelled,averageWaitMinutes:s.seated ? s.waitMs/s.seated/60000 : null,abandonmentRate:s.joined ? s.cancelled/s.joined : null,current:q.length}; }
  if (action==='log') return {ok:true,events:read_(p,'events',[]),limit:LOG_LIMIT};
  if (action==='reset') {
    const all=p.getProperties(); Object.keys(all).forEach(function(k){if(k!=='STAFF_KEY') p.deleteProperty(k);}); return {ok:true};
  }
  if (['notify','seat','cancel'].indexOf(action)!==-1) {
    if (!validId_(b.id) || q.indexOf(b.id)<0) return error_('找不到候位');
    const it=item_(p,b.id); if (!it) return error_('資料不一致');
    if (action==='notify') {
      if (it.status!=='waiting') return error_('此組已通知');
      try { MailApp.sendEmail({to:it.email,subject:'餐廳候位通知',body:'您好，您的候位號碼 '+it.id+' 已輪到，請至櫃台報到。'}); }
      catch (_) { return error_('寄信未能確認，狀態未更新；請先查收件匣再重試'); }
      it.status='notified'; it.notifiedAt=at; const writes={events:log_(p,'notify',it.id,at)}; writes['item:'+it.id]=JSON.stringify(it); p.setProperties(writes);
      return {ok:true};
    }
    return remove_(p,q,it,action,at,now);
  }
  return error_('不支援的操作');
}
function remove_(p,q,it,reason,at,now) {
  const pos=q.indexOf(it.id); q.splice(pos,1);
  // 統計歸屬取號當日，以免跨日離隊破壞分母。
  const day=today_(new Date(it.createdAt)), s=stat_(p,day);
  if (reason==='seat') {s.seated++; s.waitMs+=Math.max(0,now.getTime()-new Date(it.createdAt).getTime());} else s.cancelled++;
  const writes={queue:JSON.stringify(q),events:log_(p,reason,it.id,at)}; writes['stats:'+day]=JSON.stringify(s);
  p.setProperties(writes); p.deleteProperty('item:'+it.id); return {ok:true};
}

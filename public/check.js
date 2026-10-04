const $ = id => document.getElementById(id);
const random = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2,'0')).join('');
const sharedId = new URL(location.href).searchParams.get('room');
let attempt = null;
try { attempt = JSON.parse(sessionStorage.getItem('friends-score-probe') || 'null'); } catch {}
let id = sharedId || attempt?.id || '', key = attempt?.id === id ? attempt.key : '', room = null, busy = false, reading = false;
async function api(path, data, secret = key) {
  const response = await fetch(path, { method: data ? 'POST' : 'GET', cache: 'no-store', headers: { ...(secret ? { Authorization: 'Bearer '+secret } : {}), ...(data ? {'Content-Type':'application/json'} : {}) }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(12000) });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || '连接未成功');
  return value;
}
function message(text, error = false) { $('message').textContent=text; $('message').classList.toggle('error',error); }
function show(value) {
  room=value; $('balance').textContent=room.players[0].balance.toLocaleString('en-US');
  $('storage').textContent='云端记录已读取 ✓';
  $('create').hidden=true; $('share').hidden=false; $('change').hidden=!room.isOwner;
  $('change').disabled=busy || room.players[0].balance===1234;
  $('link').value=location.origin+'/check.html?room='+id;
  message('测试甲 · 已同步 '+new Date().toLocaleTimeString('zh-CN'));
}
async function read() {
  if (!id || reading || busy) return;
  reading=true;
  try { show((await api('/api/rooms/'+id)).room); } catch(e) { message(e.message,true); } finally { reading=false; }
}
$('create').onclick=async()=>{
  if(busy)return; busy=true; $('create').disabled=true;
  attempt=attempt||{id:random(16),key:random(32)}; id=attempt.id; key=attempt.key;
  try{
    sessionStorage.setItem('friends-score-probe',JSON.stringify(attempt));
    show((await api('/api/rooms',{id,title:'手机连接测试',initial:1000,names:['测试甲','测试乙']})).room);
    history.replaceState(null,'','/check.html?room='+id);
  }catch(e){message(e.message,true)}finally{busy=false;$('create').disabled=false;if(room)$('change').disabled=false}
};
let pending=null;
$('change').onclick=async()=>{
  if(!room||busy||room.players[0].balance===1234)return; busy=true; $('change').disabled=true;
  const delta=1234-room.players[0].balance;
  pending=pending||{action:'score',version:room.version,requestId:random(16),changes:[{id:'p1',delta},{id:'p2',delta:-delta}]};
  try{show((await api('/api/rooms/'+id,pending)).room);pending=null}catch(e){message(e.message,true)}finally{busy=false;$('change').disabled=room?.players[0].balance===1234}
};
$('refresh').onclick=()=>void read();
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('link').value);$('copy').textContent='已复制'}catch{$('link').focus();$('link').select();message('请长按链接复制')}};
(async()=>{try{await api('/api/health',undefined,'');$('health').textContent='共享服务可访问 ✓';$('create').disabled=false;if(id)await read();else message('点击下方按钮测试保存与读取。')}catch(e){$('health').textContent='共享服务暂时无法访问';message(e.message,true)}})();
setInterval(()=>{if(document.visibilityState==='visible')void read()},5000);

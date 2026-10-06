const {chromium}=require('playwright');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const base=process.env.TEST_BASE_URL||'http://localhost:8888';

const target = new URL(base);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && process.env.ALLOW_REMOTE_TESTS !== '1') {
 throw new Error('These tests create rooms. Use a local service, or explicitly set ALLOW_REMOTE_TESTS=1 for your own test deployment.');
}

const rnd=n=>crypto.randomBytes(n).toString('hex');
async function request(url,key,data){const r=await fetch(base+url,{method:data?'POST':'GET',headers:{...(key?{authorization:'Bearer '+key}:{}),...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,...await r.json()}}
(async()=>{
const id=rnd(16),key=rnd(32),payload={id,title:'自动测试活动',initial:1000,names:['甲','乙','丙']};
let r=await request('/api/rooms',key,payload);assert.equal(r.status,201);let room=r.room;
assert.equal((await request('/api/rooms',key,payload)).room.version,1);
assert.equal((await request('/api/rooms/'+id)).room.isOwner,false);
assert.equal((await request('/api/rooms/'+id,rnd(32))).status,403);
assert.equal((await request('/api/rooms/'+id,'',{action:'close',version:1,requestId:rnd(16)})).status,403);
assert.equal((await request('/api/rooms/'+id,key,{action:'score',version:1,requestId:rnd(16),changes:[{id:'p1',delta:-2},{id:'p2',delta:3}]})).status,400);
assert.equal((await request('/api/rooms/'+id)).room.version,1);
const commands=[1,2].map(()=>({action:'score',version:1,requestId:rnd(16),changes:[{id:'p1',delta:-1000},{id:'p2',delta:1000}]}));
const race=await Promise.all(commands.map(c=>request('/api/rooms/'+id,key,c)));assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
const win=race.findIndex(x=>x.status===200);room=race[win].room;
const replay=await request('/api/rooms/'+id,key,commands[win]);assert.equal(replay.room.version,room.version);assert.equal(replay.room.players[0].balance,0);
r=await request('/api/rooms/'+id,key,{action:'refill',playerId:'p1',version:room.version,requestId:rnd(16)});room=r.room;assert.equal(room.players[0].balance,1000);assert.equal(room.players[0].net,-1000);assert.equal(room.players[0].refills,1);
r=await request('/api/rooms/'+id,key,{action:'undo',version:room.version,requestId:rnd(16)});room=r.room;assert.equal(room.players[0].balance,0);assert.equal(room.players[0].refills,0);
r=await request('/api/rooms/'+id,key,{action:'add',name:'丁',version:room.version,requestId:rnd(16)});room=r.room;assert.equal(room.players[3].balance,1000);assert.equal(room.players[3].net,0);
r=await request('/api/rooms/'+id,key,{action:'close',version:room.version,requestId:rnd(16)});room=r.room;assert.equal(room.status,'closed');
assert.equal((await request('/api/rooms/'+id,key,{action:'refill',playerId:'p1',version:room.version,requestId:rnd(16)})).status,409);
assert.equal((await request('/api/rooms/'+id)).room.status,'closed');
console.log('API checks passed: access controls, balanced scores, atomic race, replay protection, refill/net, undo, add member, closed room.');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try{
const owner=await browser.newContext({viewport:{width:390,height:844}}),viewer=await browser.newContext({viewport:{width:390,height:844}});
const a=await owner.newPage(),b=await viewer.newPage();const errors=[];a.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));
await a.goto(base);await a.getByLabel('活动名称',{exact:true}).fill('周末朋友局');await a.getByLabel('每个人的初始积分').fill('1000');await a.getByLabel('参与者昵称').fill('小林\n小周\n小陈');await a.getByRole('button',{name:'创建活动并分享'}).click();
await a.getByRole('dialog').waitFor();const url=await a.locator('#share-link').inputValue();assert.ok(url.includes('?room='));assert.ok(!url.includes('manage'));
await a.getByRole('button',{name:'Close',exact:true}).click();await b.goto(url);await b.locator('[data-player=p1] .balance').waitFor();
assert.equal(await b.getByRole('button',{name:'记录积分',exact:true}).count(),0);assert.equal(await b.getByRole('button',{name:'保存管理链接'}).count(),0);
await a.getByRole('button',{name:'记录积分',exact:true}).click();await a.getByRole('button',{name:'小林减分'}).click();await a.locator('#score-p1').fill('1000');await a.locator('#score-p2').fill('1000');await a.getByRole('button',{name:'保存并同步'}).click();
await a.getByRole('dialog').waitFor({state:'hidden'});await b.waitForFunction(()=>document.querySelector('[data-player=p1] .balance')?.textContent==='0');
await a.locator('[data-player=p1]').getByRole('button',{name:'补分',exact:true}).click();await a.getByRole('button',{name:'确认补分并同步',exact:true}).click();
await b.waitForFunction(()=>document.querySelector('[data-player=p1] .balance')?.textContent==='1,000');assert.equal(await b.locator('[data-player=p1] .net-value').textContent(),'-1,000');
await a.reload();await a.getByRole('button',{name:'记录积分',exact:true}).waitFor();assert.equal(await a.locator('[data-player=p1] .refills').textContent(),'补分 1 次');
await a.getByRole('button',{name:'保存管理链接'}).click();const manage=await a.locator('#share-link').inputValue();assert.ok(manage.includes('#manage='));await a.getByRole('button',{name:'Close',exact:true}).click();
const recovered=await browser.newContext();const c=await recovered.newPage();await c.goto(manage);await c.getByRole('button',{name:'记录积分',exact:true}).waitFor();assert.ok(!c.url().includes('#manage='));
await a.getByRole('button',{name:'记录积分',exact:true}).click();await a.locator('#score-p1').fill('500');await a.getByRole('button',{name:'小周减分'}).click();await a.locator('#score-p2').fill('500');await a.getByRole('button',{name:'保存并同步'}).click();await a.getByRole('dialog').waitFor({state:'hidden'});await b.waitForFunction(()=>document.querySelector('[data-player=p1] .balance')?.textContent==='1,500');
for(const width of [320,390,600,1024]){await a.setViewportSize({width,height:844});await a.waitForTimeout(150);assert.ok(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`)}
await a.setViewportSize({width:390,height:844});fs.mkdirSync(path.join(__dirname,'../outputs'),{recursive:true});await a.screenshot({path:path.join(__dirname,'../outputs/同步网页版预览.png'),fullPage:true});await a.locator('.scoreboard').screenshot({path:path.join(__dirname,'../outputs/共享积分卡片.png')});
await viewer.setOffline(true);await b.waitForFunction(()=>document.body.textContent.includes('连接中断'),{},{timeout:20000});await viewer.setOffline(false);await b.waitForFunction(()=>document.querySelector('.sync-state')?.textContent.includes('已同步'));
assert.deepEqual(errors,[]);console.log('Browser checks passed: two isolated sessions auto-sync, viewer read-only, large scores, persistent reload, management recovery, reconnect, 320/390/600/1024px layout.');
console.log('Screenshots saved in outputs.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

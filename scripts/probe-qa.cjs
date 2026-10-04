const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
fs.mkdirSync(path.join(__dirname, '../outputs'), { recursive: true });
const base=process.env.TEST_BASE_URL||'http://localhost:8888';

const target = new URL(base);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && process.env.ALLOW_REMOTE_TESTS !== '1') {
 throw new Error('These tests create rooms. Use a local service, or explicitly set ALLOW_REMOTE_TESTS=1 for your own test deployment.');
}

(async () => {
 const browser = await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
 try {
  const a = await browser.newContext({viewport:{width:390,height:844}});
  const b = await browser.newContext({viewport:{width:390,height:844}});
  const host = await a.newPage(), viewer = await b.newPage();
  const errors=[]; host.on('pageerror',e=>errors.push(e.message)); viewer.on('pageerror',e=>errors.push(e.message));
  await host.goto(base+'/check.html');
  await host.waitForFunction(()=>!document.querySelector('#create').disabled);
  await host.locator('#create').click();
  await host.waitForFunction(()=>document.querySelector('#balance').textContent==='1,000');
  await viewer.goto(await host.locator('#link').inputValue());
  await viewer.waitForFunction(()=>document.querySelector('#balance').textContent==='1,000');
  assert.equal(await viewer.locator('#change').isVisible(),false);
  await host.locator('#change').click();
  await viewer.waitForFunction(()=>document.querySelector('#balance').textContent==='1,234');
  await viewer.reload();
  await viewer.waitForFunction(()=>document.querySelector('#balance').textContent==='1,234');
  assert.deepEqual(errors,[]);
  await host.screenshot({path:path.join(__dirname,'../outputs/手机连接测试预览.png'),fullPage:true});
  console.log('Probe passed: service reachable, cloud-adapter write/read, separate viewer updates, refresh persists. Target='+base+'');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});

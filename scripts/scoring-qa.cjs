const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.TEST_BASE_URL || 'http://localhost:8888';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname) && process.env.ALLOW_REMOTE_TESTS !== '1') {
    throw new Error('These tests create rooms; use your own local test service.');
}
const random = n => crypto.randomBytes(n).toString('hex');
(async () => {
    const id = random(16), key = random(32), endpoint = '/api/rooms/' + id;
    async function request(url, body) {
        const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const result = await response.json();
        assert.ok(response.ok, JSON.stringify(result));
        return result.room;
    }
    await request('/api/rooms', { id, title: '两种记分方式测试', initial: 20, names: ['甲', '乙', '丙'] });
    const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
    try {
        const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const viewer = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const a = await owner.newPage(), b = await viewer.newPage(), errors = [];
        a.on('pageerror', e => errors.push(e.message));
        b.on('pageerror', e => errors.push(e.message));
        const button = name => a.getByRole('button', { name, exact: true });
        const score = (id, value) => a.locator('#score-' + id).fill(value);
        const saved = () => a.getByRole('dialog').waitFor({ state: 'hidden' });
        const waitBalance = (page, id, value) => page.waitForFunction(({ id, value }) => document.querySelector(`[data-player=${id}] .balance`)?.textContent === value, { id, value });
        await a.goto(base + '?room=' + id + '#manage=' + key);
        await b.goto(base + '?room=' + id);
        await button('记录积分').click();
        await button('甲减分').click();
        await score('p1', '20'); await score('p2', '20');
        await button('按当前分数记分').click();
        assert.equal(await a.locator('#score-p1').inputValue(), '20');
        await score('p1', '0');
        assert.equal(await button('保存并同步').isEnabled(), false); // Unbalanced totals.
        await score('p2', '40');
        assert.equal(await button('保存并同步').isEnabled(), true); // Explicit zero is valid.
        for (const invalid of ['', '-1', '1.5', '1000000001', 'abc']) {
            await score('p3', invalid);
            assert.equal(await button('保存并同步').isEnabled(), false, invalid);
        }
        await score('p3', '20');
        await button('按变化量记分').click();
        assert.equal(await a.locator('#score-p1').inputValue(), '20');
        assert.equal(await button('甲减分').getAttribute('aria-pressed'), 'true');
        await button('按当前分数记分').click();
        assert.equal(await a.locator('#score-p1').inputValue(), '0');
        for (const width of [320, 390, 600, 1024]) {
            await a.setViewportSize({ width, height: 844 });
            assert.ok(await a.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `score dialog overflow at ${width}`);
        }
        await a.setViewportSize({ width: 390, height: 844 });
        fs.mkdirSync(path.join(__dirname, '../outputs'), { recursive: true });
        await a.screenshot({ animations: 'disabled', path: path.join(__dirname, '../outputs/按当前分数记分.png') });
        await button('保存并同步').click(); await saved();
        await waitBalance(b, 'p1', '0');
        assert.equal(await b.locator('[data-player=p1] .net-value').textContent(), '-20');
        assert.equal(await b.getByRole('button', { name: '补分', exact: true }).count(), 0);
        async function openRefill() {
            await a.locator('[data-player=p1]').getByRole('button', { name: '补分', exact: true }).click();
        }
        await openRefill();
        assert.equal(await a.getByLabel('本次补多少分').inputValue(), '20');
        for (const invalid of ['', '0', '-1', '1.5', '1000000001']) {
            await a.getByLabel('本次补多少分').fill(invalid);
            assert.equal(await button('确认补分并同步').isEnabled(), false, invalid);
        }
        await a.getByLabel('本次补多少分').fill('50');
        for (const width of [320, 390]) {
            await a.setViewportSize({ width, height: 844 });
            assert.ok(await a.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        }
        await a.screenshot({ animations: 'disabled', path: path.join(__dirname, '../outputs/自定义补分.png') });
        await button('确认补分并同步').click(); await saved();
        await waitBalance(b, 'p1', '50');
        assert.equal(await b.locator('[data-player=p1] .net-value').textContent(), '-20');
        assert.ok(await a.locator('.history').textContent().then(t => t.includes('甲 补分 +50')));
        await button('撤销').click(); await button('确认').click();
        await a.getByRole('alertdialog').waitFor({ state: 'hidden' });
        await waitBalance(b, 'p1', '0');
        assert.equal((await request(endpoint)).players[0].refillTotal, 0);
        // Persist a request but discard the response, simulating a lost mobile connection.
        async function loseNextResponse() {
            const handler = async route => {
                if (route.request().method() !== 'POST') return route.continue();
                await route.fetch();
                await route.abort('failed');
                await a.unroute('**/api/rooms/' + id, handler);
            };
            await a.route('**/api/rooms/' + id, handler);
        }
        await openRefill(); await a.getByLabel('本次补多少分').fill('50');
        await loseNextResponse(); await button('确认补分并同步').click();
        await a.getByRole('dialog').getByText('未能确认保存结果', { exact: false }).waitFor();
        await waitBalance(a, 'p1', '50');
        const refillVersion = (await request(endpoint)).version;
        await button('确认补分并同步').click(); await saved();
        assert.equal((await request(endpoint)).version, refillVersion);
        assert.equal((await request(endpoint)).players[0].refills, 1);
        // Absolute-score retries must also be exactly-once after polling observes the result.
        await button('记录积分').click(); await score('p1', '40'); await score('p2', '50');
        await loseNextResponse(); await button('保存并同步').click();
        await a.getByRole('dialog').getByText('未能确认保存结果', { exact: false }).waitFor();
        await waitBalance(a, 'p1', '40');
        const scoreVersion = (await request(endpoint)).version;
        await button('保存并同步').click(); await saved();
        assert.equal((await request(endpoint)).version, scoreVersion);
        await waitBalance(b, 'p1', '40');
        assert.equal(await b.locator('[data-player=p1] .net-value').textContent(), '-30');
        // A second manager's change must not be silently overwritten by a stale absolute draft.
        async function anotherManager() {
            const current = await request(endpoint);
            return request(endpoint, { action: 'score', version: current.version, requestId: random(16), changes: [{ id: 'p1', delta: 1 }, { id: 'p2', delta: -1 }] });
        }
        await button('记录积分').click(); await score('p1', '35'); await score('p2', '55');
        await anotherManager();
        await a.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await button('载入最新积分并重新填写').waitFor();
        assert.equal(await button('保存并同步').isEnabled(), false);
        assert.equal(await a.locator('#score-p1').inputValue(), '35');
        await button('载入最新积分并重新填写').click();
        assert.equal(await a.locator('#score-p1').inputValue(), '41');
        await score('p1', '40'); await score('p2', '50');
        // Race the save itself; a 409 must keep the old draft blocked until explicitly reset.
        const raceHandler = async route => {
            if (route.request().method() !== 'POST') return route.continue();
            await anotherManager();
            await route.continue();
            await a.unroute('**/api/rooms/' + id, raceHandler);
        };
        await a.route('**/api/rooms/' + id, raceHandler);
        await button('保存并同步').click();
        await button('载入最新积分并重新填写').waitFor();
        assert.equal(await button('保存并同步').isEnabled(), false);
        assert.equal((await request(endpoint)).players[0].balance, 42);
        await button('载入最新积分并重新填写').click();
        assert.equal(await a.locator('#score-p1').inputValue(), '42');
        await score('p1', '40'); await score('p2', '50');
        await button('保存并同步').click(); await saved();
        await waitBalance(b, 'p1', '40');
        await button('撤销').click(); await button('确认').click();
        await a.getByRole('alertdialog').waitFor({ state: 'hidden' });
        await waitBalance(b, 'p1', '42');
        assert.deepEqual(errors, []);
        console.log('New scoring checks passed: arbitrary refill, net/undo, both modes/drafts, zero/invalid totals, mobile layouts, viewer sync, lost-response retries and concurrent managers.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

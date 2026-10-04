import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { makeHandler, type RoomRecord, type RoomStore } from '../server/rooms';
const random = (n: number) => randomBytes(n).toString('hex');
function fixture() {
    const records = new Map<string, {
        data: RoomRecord;
        etag: string;
    }>();
    let version = 0;
    const storage: RoomStore = {
        async read(id) { return structuredClone(records.get(id) || null); },
        async write(id, data, condition) {
            const old = records.get(id);
            if (condition.onlyIfNew && old)
                return false;
            if (condition.onlyIfMatch && old?.etag !== condition.onlyIfMatch)
                return false;
            records.set(id, { data: structuredClone(data), etag: String(++version) });
            return true;
        },
    };
    const handler = makeHandler(storage);
    const id = random(16), key = random(32);
    async function call(path: string, body?: unknown, token = key, headers: Record<string, string> = {}) {
        const response = await handler(new Request('https://test.local' + path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
        }));
        return { status: response.status, headers: response.headers, ...await response.json() };
    }
    const payload = { id, title: '测试', initial: 1000, names: ['甲', '乙'] };
    const command = (version = 1, requestId = random(16)) => ({ action: 'score', version, requestId, changes: [{ id: 'p1', delta: -1000 }, { id: 'p2', delta: 1000 }] });
    return { call, id, key, payload, command, handler };
}
test('房主与观众权限；公开响应不泄露管理凭据', async () => {
    const f = fixture();
    assert.equal((await f.call('/api/rooms', f.payload)).status, 201);
    const viewer = await f.call('/api/rooms/' + f.id, undefined, '');
    assert.equal(viewer.room.isOwner, false);
    assert.equal(viewer.headers.get('cache-control'), 'no-store');
    assert.ok(!JSON.stringify(viewer).includes(f.key));
    assert.ok(!JSON.stringify(viewer).includes('ownerHash'));
    assert.equal((await f.call('/api/rooms/' + f.id, f.command(), '')).status, 403);
    assert.equal((await f.call('/api/rooms/' + f.id, undefined, random(32))).status, 403);
});
test('创建重试不覆盖已有积分，也不能抢占别人的房间', async () => {
    const f = fixture();
    await f.call('/api/rooms', f.payload);
    await f.call('/api/rooms/' + f.id, f.command());
    const retry = await f.call('/api/rooms', f.payload);
    assert.equal(retry.room.version, 2);
    assert.equal(retry.room.players[0].balance, 0);
    assert.equal((await f.call('/api/rooms', f.payload, random(32))).status, 409);
});
test('不同并发操作只能一个成功；相同操作并发或重试只记一次', async () => {
    const f = fixture();
    await f.call('/api/rooms', f.payload);
    const commands = [f.command(), f.command()];
    const race = await Promise.all(commands.map(c => f.call('/api/rooms/' + f.id, c)));
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    const winner = commands[race.findIndex(r => r.status === 200)];
    assert.equal((await f.call('/api/rooms/' + f.id, winner)).room.version, 2);
    const g = fixture();
    await g.call('/api/rooms', g.payload);
    const cmd = g.command();
    const duplicates = await Promise.all([g.call('/api/rooms/' + g.id, cmd), g.call('/api/rooms/' + g.id, cmd)]);
    assert.deepEqual(duplicates.map(r => r.status), [200, 200]);
    assert.equal((await g.call('/api/rooms/' + g.id)).room.version, 2);
});
test('归零补回初始值不增加净得分，撤销恢复，结束后只读', async () => {
    const f = fixture();
    const path = '/api/rooms/' + f.id;
    await f.call('/api/rooms', f.payload);
    await f.call(path, f.command());
    let result = await f.call(path, { action: 'refill', playerId: 'p1', version: 2, requestId: random(16) });
    assert.equal(result.room.players[0].balance, 1000);
    assert.equal(result.room.players[0].net, -1000);
    result = await f.call(path, { action: 'undo', version: 3, requestId: random(16) });
    assert.equal(result.room.players[0].balance, 0);
    assert.equal(result.room.players[0].refillTotal, 0);
    await f.call(path, { action: 'close', version: 4, requestId: random(16) });
    assert.equal((await f.call(path, f.command(5))).status, 409);
});
test('跨来源、过大请求、无效输入和不平衡积分被拒绝且不写入', async () => {
    const f = fixture();
    assert.equal((await f.call('/api/rooms', f.payload, f.key, { Origin: 'https://elsewhere.local' })).status, 403);
    assert.equal((await f.call('/api/rooms', { ...f.payload, title: 'x'.repeat(17000) })).status, 413);
    assert.equal((await f.call('/api/rooms', { ...f.payload, initial: 1.5 })).status, 400);
    await f.call('/api/rooms', f.payload);
    const cmd = f.command();
    cmd.changes[1].delta = 999;
    assert.equal((await f.call('/api/rooms/' + f.id, cmd)).status, 400);
    assert.equal((await f.call('/api/rooms/' + f.id)).room.version, 1);
    const malformed = await f.handler(new Request('https://test.local/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }));
    assert.equal(malformed.status, 400);
});
test('存储故障明确报错，不显示虚假的保存成功', async () => {
    const handler = makeHandler({ async read() { throw new Error('offline'); }, async write() { throw new Error('offline'); } });
    assert.equal((await handler(new Request('https://test.local/api/rooms/' + random(16)))).status, 503);
});

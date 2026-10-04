import { RuleError, check, create, apply, view, type Room, type Command } from '../src/lib/scoring';
// 一个房间存成一份文档。ETag 标记文档版本，修改前检查它未变，防止覆盖。
export interface RoomRecord {
    ownerHash: string;
    state: Room;
}
export interface RoomStore {
    read(id: string): Promise<{
        data: RoomRecord;
        etag: string;
    } | null>;
    write(id: string, record: RoomRecord, condition: { onlyIfNew: true; onlyIfMatch?: never } | { onlyIfMatch: string; onlyIfNew?: never }): Promise<boolean>;
}
export function json(data: unknown, status = 200) {
    return Response.json(data, { status, headers: {
            'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        } });
}
async function readBody(request: Request) {
    check((request.headers.get('content-type') || '').split(';')[0].trim() === 'application/json', '请求格式无效', 415);
    check(!request.headers.get('origin') || request.headers.get('origin') === new URL(request.url).origin, '请求来源无效', 403);
    check(Number(request.headers.get('content-length') || 0) <= 16384, '操作内容过长', 413);
    const reader = request.body?.getReader();
    check(reader, '缺少操作内容');
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        bytes += value.length;
        if (bytes > 16384) {
            await reader.cancel();
            throw new RuleError('操作内容过长', 413);
        }
        chunks.push(value);
    }
    const all = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
    }
    try {
        return JSON.parse(new TextDecoder().decode(all));
    }
    catch {
        throw new RuleError('操作内容格式无效');
    }
}
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
function key(request: Request) {
    const raw = request.headers.get('authorization');
    if (!raw)
        return '';
    check(/^Bearer [a-f0-9]{64}$/.test(raw), '管理凭证无效', 403);
    return raw.slice(7);
}
async function hash(value: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function makeHandler(store: RoomStore) {
    async function read(id: string) {
        check(validId(id), '房间链接无效', 404);
        const row = await store.read(id);
        check(row, '找不到这场活动，请检查房间链接', 404);
        return row;
    }
    return async (request: Request): Promise<Response> => {
        try {
            const path = new URL(request.url).pathname;
            if (path === '/api/health' && request.method === 'GET') {
                return json({ ok: true, service: 'friends-score', storage: 'not-tested' });
            }
            if (path === '/api/rooms') {
                check(request.method === 'POST', '此接口只接受创建请求', 405);
                const data = await readBody(request);
                check(data && typeof data === 'object' && !Array.isArray(data), '创建内容无效');
                check(validId(data.id), '活动标识无效');
                const secret = key(request);
                check(secret, '缺少管理凭证', 403);
                const ownerHash = await hash(secret);
                const state = create(data.id, data);
                // 相同创建请求重试不会覆盖已有记录。
                await store.write(state.id, { ownerHash, state }, { onlyIfNew: true });
                const row = await read(state.id);
                check(row.data.ownerHash === ownerHash, '活动标识已使用，请重新创建', 409);
                return json({ room: view(row.data.state, true) }, 201);
            }
            const match = /^\/api\/rooms\/([a-f0-9]{32})$/.exec(path);
            check(match, '找不到这个接口', 404);
            check(['GET', 'POST'].includes(request.method), '请求方法不支持', 405);
            const id = match[1];
            const row = await read(id);
            const secret = key(request);
            const isOwner = !!secret && await hash(secret) === row.data.ownerHash;
            check(!secret || isOwner, '管理凭证无效，请使用原来的管理链接', 403);
            if (request.method === 'GET')
                return json({ room: view(row.data.state, isOwner) });
            check(isOwner, '只有创建者可以记分', 403);
            const command = await readBody(request) as Command;
            const next = apply(row.data.state, command);
            if (next.version !== row.data.state.version) {
                const modified = await store.write(id, { ...row.data, state: next }, { onlyIfMatch: row.etag });
                if (!modified) {
                    // 同一个操作重复抵达，返回已经保存的结果。
                    const latest = await read(id);
                    if (latest.data.state.requests.includes(command.requestId))
                        return json({ room: view(latest.data.state, true) });
                    throw new RuleError('其他设备已更新积分，请核对最新积分后重新提交', 409);
                }
            }
            return json({ room: view(next, true) });
        }
        catch (error) {
            if (error instanceof RuleError)
                return json({ error: error.message }, error.status);
            console.error('room-storage-failed', error instanceof Error ? error.name : 'unknown');
            return json({ error: '暂时无法连接共享服务，请稍后重试。未确认的操作请先刷新核对。' }, 503);
        }
    };
}

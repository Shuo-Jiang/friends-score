export class RuleError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export function check(ok: unknown, message: string, status = 400): asserts ok { if (!ok)
    throw new RuleError(message, status); }
export function integer(value: unknown, min: number, max: number, label: string): number { check(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, `${label}须为 ${min} 至 ${max} 的整数`); return value; }
export function name(value: unknown): string { check(typeof value === 'string', '请填写昵称'); const s = value.trim(); check(s.length > 0 && s.length <= 12 && !/[\x00-\x1f\x7f]/.test(s), '昵称须为 1 至 12 个字符'); return s; }
export interface Player {
    id: string;
    name: string;
    initial: number;
    balance: number;
    refills: number;
    refillTotal: number;
}
export interface Event {
    id: string;
    at: number;
    type: string;
    text: string;
    details?: {
        name: string;
        delta: number;
    }[];
    before?: Player[];
    undone?: boolean;
}
export interface Room {
    id: string;
    title: string;
    initial: number;
    status: 'active' | 'closed';
    version: number;
    createdAt: number;
    updatedAt: number;
    players: Player[];
    events: Event[];
    requests: string[];
}
export interface Command {
    action: string;
    requestId: string;
    version: number;
    changes?: {
        id: string;
        delta: number;
    }[];
    playerId?: string;
    name?: string;
}
export function create(id: string, input: {
    title: unknown;
    initial: unknown;
    names: unknown;
}, now = Date.now()): Room {
    check(typeof input.title === 'string' && input.title.trim().length > 0 && input.title.trim().length <= 24, '活动名称须为 1 至 24 个字符');
    const initial = integer(input.initial, 1, 1000000, '初始积分');
    check(Array.isArray(input.names) && input.names.length >= 2 && input.names.length <= 12, '请填写 2–12 位参与者');
    const names = input.names.map(name);
    check(new Set(names).size === names.length, '昵称不能重复');
    return { id, title: input.title.trim(), initial, status: 'active', version: 1, createdAt: now, updatedAt: now, players: names.map((name, i) => ({ id: `p${i + 1}`, name, initial, balance: initial, refills: 0, refillTotal: 0 })), events: [], requests: [] };
}
export function apply(room: Room, c: Command, now = Date.now()): Room {
    check(c && typeof c === 'object', '操作无效');
    check(typeof c.requestId === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(c.requestId), '操作标识无效');
    if (room.requests.includes(c.requestId))
        return room;
    check(room.status === 'active', '活动已结束，不能继续修改', 409);
    check(c.version === room.version, '其他设备已更新积分，请核对最新积分后重新提交', 409);
    const r = structuredClone(room);
    let e: Event = { id: c.requestId, at: now, type: c.action, text: '' };
    if (c.action === 'score') {
        check(Array.isArray(c.changes) && c.changes.length >= 2 && c.changes.length <= 12, '请记录至少两人的积分变化');
        const seen = new Set<string>();
        let sum = 0;
        e.before = [];
        e.details = [];
        e.text = '记录积分';
        for (const item of c.changes) {
            check(item && typeof item === 'object', '积分变化无效');
            const p = r.players.find(p => p.id === item.id);
            check(p && !seen.has(p.id), '参与者无效或重复');
            seen.add(p.id);
            const delta = integer(item.delta, -1000000000, 1000000000, '变化积分');
            check(delta !== 0, '无需提交零分变化');
            integer(p.balance + delta, 0, 1000000000, `${p.name} 的当前积分`);
            e.before.push({ ...p });
            e.details.push({ name: p.name, delta });
            p.balance += delta;
            sum += delta;
        }
        check(sum === 0, '增加与减少的积分需相等，请检查漏记或误记');
    }
    else if (c.action === 'refill') {
        const p = r.players.find(p => p.id === c.playerId);
        check(p, '参与者不存在');
        check(p.balance === 0, '只有积分归零后才能补分');
        integer(p.refillTotal + r.initial, 0, 1000000000, '累计补分');
        e.before = [{ ...p }];
        e.text = `${p.name} 补分 +${r.initial}`;
        p.balance = r.initial;
        p.refills++;
        p.refillTotal += r.initial;
    }
    else if (c.action === 'undo') {
        const target = r.events.slice().reverse().find(e => ['score', 'refill'].includes(e.type) && !e.undone);
        check(target, '没有可以撤销的记分或补分');
        target.before!.forEach(old => Object.assign(r.players.find(p => p.id === old.id)!, old));
        target.undone = true;
        e.text = `撤销：${target.text}`;
    }
    else if (c.action === 'add') {
        check(r.players.length < 12, '最多支持 12 位参与者');
        const n = name(c.name);
        check(!r.players.some(p => p.name === n), '昵称已有人使用');
        r.players.push({ id: `p${r.players.length + 1}`, name: n, initial: r.initial, balance: r.initial, refills: 0, refillTotal: 0 });
        e.text = `${n} 加入活动`;
    }
    else if (c.action === 'close') {
        r.status = 'closed';
        e.text = '活动结束，排名已保存';
    }
    else
        throw new RuleError('不支持的操作');
    r.events.push(e);
    r.events = r.events.slice(-200);
    r.requests.push(c.requestId);
    r.requests = r.requests.slice(-200);
    r.version++;
    r.updatedAt = now;
    return r;
}
export function view(r: Room, isOwner: boolean) { return { id: r.id, title: r.title, initial: r.initial, status: r.status, version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt, isOwner, players: r.players.map(p => ({ ...p, net: p.balance - p.initial - p.refillTotal })), events: r.events.map(({ before, ...e }) => e), canUndo: r.events.some(e => ['score', 'refill'].includes(e.type) && !e.undone) }; }
export type RoomView = ReturnType<typeof view>;

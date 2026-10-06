"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView, Command } from '@/lib/scoring';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Plus, Share2, Undo2, ArrowLeft, RefreshCw, KeyRound, Check, Users } from 'lucide-react';
type Saved = {
    id: string;
    title: string;
    key?: string;
};
type Confirmation = {
    title: string;
    description: string;
    action: string;
    version: number;
    playerId?: string;
};
const number = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? '+' : '') + number(n);
const random = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const validId = (id: string) => /^[a-f0-9]{32}$/.test(id);
function readLinks(): Saved[] { try {
    const v = JSON.parse(localStorage.getItem('friends-score-links') || '[]');
    return Array.isArray(v) ? v.filter(x => x && validId(x.id) && typeof x.title === 'string' && (!x.key || /^[a-f0-9]{64}$/.test(x.key))).slice(0, 30) : [];
}
catch {
    return [];
} }
class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
async function api(path: string, key = '', data?: unknown) { const response = await fetch(path, { method: data ? 'POST' : 'GET', cache: 'no-store', headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(12000) }); let json: {
    error?: string;
    room: RoomView;
}; try {
    json = await response.json() as {
        error?: string;
        room: RoomView;
    };
}
catch {
    throw new ApiError('共享服务暂时不可用，请稍后重试', response.status);
} if (!response.ok)
    throw new ApiError(json.error || '操作未完成，请稍后再试', response.status); return json as {
    room: RoomView;
}; }
export default function Home() {
    const [roomId, setRoomId] = useState(''), [room, setRoom] = useState<RoomView | null>(null), [links, setLinks] = useState<Saved[]>([]), [ready, setReady] = useState(false);
    const [title, setTitle] = useState(''), [initial, setInitial] = useState('1000'), [names, setNames] = useState(''), [createError, setCreateError] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sync, setSync] = useState<'connecting' | 'ok' | 'error'>('connecting'), [lastSync, setLastSync] = useState(0);
    const [dialog, setDialog] = useState<'score' | 'share' | 'manage' | 'add' | 'refill' | null>(null), [dialogError, setDialogError] = useState(''), [copyDone, setCopyDone] = useState(false);
    const [draft, setDraft] = useState<Record<string, {
        sign: number;
        amount: string;
    }>>({}), [draftVersion, setDraftVersion] = useState(0), [memberName, setMemberName] = useState(''), [confirmation, setConfirmation] = useState<Confirmation | null>(null);
    const [scoreMode, setScoreMode] = useState<'delta' | 'balance'>('delta');
    const [scorePlayers, setScorePlayers] = useState<RoomView['players']>([]);
    const [balances, setBalances] = useState<Record<string, string>>({});
    const [refillPlayerId, setRefillPlayerId] = useState(''), [refillAmount, setRefillAmount] = useState('');
    const credentials = useRef<Record<string, string>>({}), active = useRef(''), roomRef = useRef<RoomView | null>(null), createAttempt = useRef<{
        id: string;
        key: string;
    } | null>(null), pending = useRef<{
        signature: string;
        command: Command;
    } | null>(null), busyRef = useRef(false);
    const saveLink = useCallback((entry: Saved) => { setLinks(old => { const next = [entry, ...old.filter(x => x.id !== entry.id)].slice(0, 30); try {
        localStorage.setItem('friends-score-links', JSON.stringify(next));
    }
    catch { } return next; }); }, []);
    const accept = useCallback((r: RoomView) => { if (active.current !== r.id)
        return; if (!roomRef.current || roomRef.current.id !== r.id || r.version >= roomRef.current.version) {
        roomRef.current = r;
        setRoom(r);
    } setSync('ok'); setError(''); setLastSync(Date.now()); }, []);
    const navigate = useCallback((id: string) => { active.current = id; roomRef.current = null; setRoom(null); setRoomId(id); setError(''); setSync('connecting'); setDialog(null); setConfirmation(null); window.history.pushState({}, '', id ? '?room=' + id : window.location.pathname); }, []);
    useEffect(() => {
        const list = readLinks();
        setLinks(list);
        for (const item of list)
            if (item.key)
                credentials.current[item.id] = item.key;
        const loadLocation = () => { const params = new URLSearchParams(location.search), fragment = new URLSearchParams(location.hash.slice(1)); const id = params.get('room') || ''; const key = fragment.get('manage'); if (validId(id) && key && /^[a-f0-9]{64}$/.test(key)) {
            credentials.current[id] = key;
            const entry = { id, title: list.find(x => x.id === id)?.title || '我的活动', key };
            saveLink(entry);
            history.replaceState({}, '', '?room=' + id);
        } active.current = id; roomRef.current = null; setRoom(null); setRoomId(id); setError(''); setDialog(null); setConfirmation(null); };
        loadLocation();
        setReady(true);
        window.addEventListener('popstate', loadLocation);
        return () => window.removeEventListener('popstate', loadLocation);
    }, [saveLink]);
    const refresh = useCallback(async (id = active.current) => { if (!id)
        return; try {
        const data = await api('/api/rooms/' + id, credentials.current[id] || '');
        accept(data.room);
        saveLink({ id, title: data.room.title, ...(credentials.current[id] ? { key: credentials.current[id] } : {}) });
        return data.room;
    }
    catch (e) {
        if (active.current === id) {
            setSync('error');
            setError(e instanceof ApiError ? e.message : '连接中断，正在重试。下方积分可能不是最新的。');
        }
        return undefined;
    } }, [accept, saveLink]);
    useEffect(() => { if (!ready || !roomId)
        return; let stopped = false, running = false, timer: ReturnType<typeof setTimeout>; const poll = async () => { if (stopped || running)
        return; running = true; if (document.visibilityState === 'visible' && !busyRef.current)
        await refresh(roomId); running = false; if (!stopped)
        timer = setTimeout(poll, roomRef.current?.status === 'closed' ? 30000 : 5000); }; void poll(); const wake = () => { clearTimeout(timer); void poll(); }; window.addEventListener('online', wake); document.addEventListener('visibilitychange', wake); return () => { stopped = true; clearTimeout(timer); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); }; }, [ready, roomId, refresh]);
    function beginBusy() { if (busyRef.current)
        return false; busyRef.current = true; setBusy(true); return true; }
    function endBusy() { busyRef.current = false; setBusy(false); }
    async function createActivity(e: React.FormEvent) {
        e.preventDefault();
        setCreateError('');
        if (!/^\d+$/.test(initial) || Number(initial) < 1 || Number(initial) > 1000000) {
            setCreateError('初始积分请填写 1 至 1,000,000 的整数');
            return;
        }
        if (!beginBusy())
            return;
        const attempt = createAttempt.current ?? { id: random(16), key: random(32) };
        createAttempt.current = attempt;
        try {
            const { room: r } = await api('/api/rooms', attempt.key, { id: attempt.id, title, initial: Number(initial), names: names.split(/\r?\n/).map(x => x.trim()).filter(Boolean) });
            credentials.current[r.id] = attempt.key;
            saveLink({ id: r.id, title: r.title, key: attempt.key });
            navigate(r.id);
            accept(r);
            createAttempt.current = null;
            setTitle('');
            setNames('');
            setDialog('share');
        }
        catch (e) {
            setCreateError(e instanceof Error ? e.message : '创建未完成，请重试');
        }
        finally {
            endBusy();
        }
    }
    async function submit(action: string, version: number, extra: Partial<Command> = {}) { if (!room || !beginBusy())
        return false; setDialogError(''); setError(''); const signature = JSON.stringify({ id: room.id, action, version, ...extra }); const command = pending.current?.signature === signature ? pending.current.command : { action, version, ...extra, requestId: random(16) }; pending.current = { signature, command }; try {
        const data = await api('/api/rooms/' + room.id, credentials.current[room.id] || '', command);
        accept(data.room);
        pending.current = null;
        setDialog(null);
        setConfirmation(null);
        return true;
    }
    catch (e) {
        const message = e instanceof ApiError ? e.message : '未能确认保存结果，请检查网络后重试；相同操作不会重复记分。';
        setDialogError(message);
        setError(message);
        const latest = await refresh(room.id);
        if (e instanceof ApiError && e.status === 409) {
            pending.current = null;
            if (latest) {
                if (action !== 'score') setDraftVersion(latest.version);
                setConfirmation(old => old ? { ...old, version: latest.version } : null);
            }
        }
        return false;
    }
    finally {
        endBusy();
    } }
    function openScore() {
        if (!room) return;
        setScorePlayers(room.players);
        setDraft(Object.fromEntries(room.players.map(p => [p.id, { sign: 1, amount: '' }])));
        setBalances(Object.fromEntries(room.players.map(p => [p.id, String(p.balance)])));
        setDraftVersion(room.version);
        setDialogError('');
        setDialog('score');
    }
    // Keep the balances and version from when editing began; polling must not rebase a draft.
    const changes = scorePlayers.map(p => ({ id: p.id, delta: scoreMode === 'balance'
        ? Number(balances[p.id]) - p.balance
        : (draft[p.id]?.sign ?? 1) * Number(draft[p.id]?.amount || 0)
    })).filter(c => c.delta !== 0);
    const deltaTotal = changes.reduce((sum, c) => sum + c.delta, 0);
    const validInputs = scorePlayers.every(p => scoreMode === 'balance'
        ? /^\d+$/.test(balances[p.id] ?? '')
        : !draft[p.id]?.amount || /^\d+$/.test(draft[p.id].amount));
    const validChanges = validInputs && changes.length >= 2 && deltaTotal === 0 && changes.every(c => {
        const next = scorePlayers.find(p => p.id === c.id)!.balance + c.delta;
        return Number.isSafeInteger(c.delta) && Math.abs(c.delta) <= 1000000000 && next >= 0 && next <= 1000000000;
    });
    const scoreStale = room?.version !== draftVersion;
    // Retrying an uncertain response must reuse its request ID, even if polling saw the result.
    const retryScore = pending.current?.signature === JSON.stringify({ id: room?.id, action: 'score', version: draftVersion, changes });
    const canSaveScore = validChanges && (!scoreStale || retryScore) && room?.status === 'active';
    const refillPlayer = room?.players.find(p => p.id === refillPlayerId);
    const refillValue = Number(refillAmount);
    const validRefill = /^\d+$/.test(refillAmount) && Number.isSafeInteger(refillValue) && refillValue > 0
        && refillValue <= 1000000000 && !!refillPlayer && refillPlayer.balance === 0
        && refillPlayer.refillTotal + refillValue <= 1000000000 && room?.status === 'active';
    const retryRefill = pending.current?.signature === JSON.stringify({ id: room?.id, action: 'refill', version: draftVersion, playerId: refillPlayerId, amount: refillValue });
    const canSaveRefill = validRefill || retryRefill;
    function openRefill(playerId: string) {
        if (!room) return;
        setRefillPlayerId(playerId);
        setRefillAmount(String(room.initial));
        setDraftVersion(room.version);
        setDialogError('');
        setDialog('refill');
    }
    function ask(action: string, heading: string, description: string, playerId?: string) { if (room)
        setConfirmation({ title: heading, description, action, version: room.version, playerId }); setDialogError(''); }
    const origin = typeof window === 'undefined' ? '' : window.location.origin + window.location.pathname;
    const shareUrl = room ? origin + '?room=' + room.id : '';
    const manageUrl = shareUrl + (room && credentials.current[room.id] ? '#manage=' + credentials.current[room.id] : '');
    async function copy(value: string) { try {
        await navigator.clipboard.writeText(value);
        setCopyDone(true);
        setTimeout(() => setCopyDone(false), 1800);
    }
    catch {
        setDialogError('请长按下面的链接，选择复制。');
    } }
    useEffect(() => { const context = (document as Document & {
        modelContext?: {
            registerTool: (tool: unknown, options: {
                signal: AbortSignal;
            }) => unknown;
        };
    }).modelContext; if (!context?.registerTool)
        return; const controller = new AbortController(); try {
        void Promise.resolve(context.registerTool({ name: 'read_current_scoreboard', title: '查看当前活动积分', description: '读取当前已打开活动的最新共享积分与排名，不修改积分。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute: async (input: unknown) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length)
                throw new Error('无需参数'); if (!active.current)
                throw new Error('请先打开一场活动'); const r = await refresh(); if (!r)
                throw new Error('无法读取最新积分'); return { title: r.title, status: r.status, players: r.players.map(p => ({ name: p.name, balance: p.balance, net: p.net, refills: p.refills })) }; } }, { signal: controller.signal })).catch(() => { });
    }
    catch { } return () => controller.abort(); }, [refresh]);
    const ranked = room ? [...room.players].sort((a, b) => b.net - a.net) : [];
    const ownerActive = !!room?.isOwner && room.status === 'active';
    return <main className="shell"><header className="brand"><span className="brand-mark">记</span><div><strong>一起记分</strong><p>朋友间的共享积分板</p></div><span className="badge">多人同步版</span></header>
 {!roomId ? <><section className="intro"><h1>开一场，一起看。</h1><p>由你记分，朋友打开房间链接就能看到积分与排名。</p></section><section className="panel"><h2>创建活动</h2><form className="form-stack" onSubmit={createActivity}><Label htmlFor="title">活动名称</Label><Input id="title" placeholder="例如：周末朋友局" maxLength={24} value={title} onChange={e => setTitle(e.target.value)} required disabled={busy || !ready}/><Label htmlFor="initial">每个人的初始积分</Label><Input id="initial" inputMode="numeric" value={initial} onChange={e => setInitial(e.target.value)} required disabled={busy || !ready}/><Label htmlFor="names">参与者昵称</Label><Textarea id="names" placeholder={"小林\n小周\n小陈"} rows={4} value={names} onChange={e => setNames(e.target.value)} required disabled={busy || !ready}/><p className="muted">每行一位，2–12 人。初始积分支持 1–1,000,000。</p>{createError && <p className="error" role="alert">{createError}</p>}<Button className="primary wide" type="submit" disabled={busy || !ready}><Plus />{busy ? '正在创建…' : '创建活动并分享'}</Button></form></section>{links.length > 0 && <section className="panel"><h2>最近打开</h2><div className="recent-list">{links.map(item => <Button key={item.id} variant="ghost" className="recent" onClick={() => navigate(item.id)}><span>{item.title}</span><span className="muted">{item.key ? '我负责记分' : '查看积分'}</span></Button>)}</div><p className="muted">记录保存在云端；这里的入口只保存在当前浏览器。</p></section>}</> : <><div className="room-nav"><Button variant="ghost" onClick={() => navigate('')} disabled={busy || !ready}><ArrowLeft />返回首页</Button><Button variant="ghost" onClick={() => void refresh()} disabled={busy || !ready}><RefreshCw />刷新</Button></div>{error && <p className="error" role="alert">{error}</p>}{!room ? <section className="panel loading"><h1>{sync === 'error' ? '暂时无法打开活动' : '正在读取共享积分…'}</h1><p className="muted">{sync === 'error' ? '请检查网络或房间链接，再点击刷新。' : '请稍候。'}</p></section> : <><section className="room-title"><div className="eyebrow">{room.status === 'closed' ? '活动已结束' : room.isOwner ? '你负责记分' : '正在查看朋友的积分'}</div><h1>{room.title}</h1><p className="muted">{room.players.length} 位朋友 · 初始 {number(room.initial)} 分</p><div className={'sync-state ' + (sync === 'error' ? 'stale' : '')} role="status">{sync === 'ok' ? <Check size={15}/> : <RefreshCw size={15}/>}<span>{sync === 'ok' ? '已同步 · ' + new Date(lastSync).toLocaleTimeString('zh-CN', { hour12: false }) : sync === 'error' ? '连接中断 · 正在重试' : '正在同步'}</span></div></section><div className="room-toolbar"><Button variant="outline" onClick={() => { setCopyDone(false); setDialogError(''); setDialog('share'); }}><Share2 />分享查看链接</Button>{room.isOwner && <Button variant="ghost" onClick={() => { setCopyDone(false); setDialogError(''); setDialog('manage'); }}><KeyRound />保存管理链接</Button>}</div><section className="panel scoreboard"><div className="section-heading"><h2>玩家积分</h2><span className="muted">按净得分排序</span></div><p className="muted formula">净得分 = 当前积分 − 初始积分 − 累计补分</p><div className="players">{ranked.map((p, i) => { const rank = i > 0 && ranked[i - 1].net === p.net ? ranked.findIndex(x => x.net === p.net) + 1 : i + 1; return <article className={'player ' + (Math.abs(p.net) > 999999 || p.balance > 999999 ? 'wide-number' : '')} key={p.id} data-player={p.id}><div className="player-heading"><div className="identity"><span className={'rank ' + (rank === 1 ? 'first' : '')}>{rank}</span><strong>{p.name}</strong></div><span className="refills">补分 {p.refills} 次</span></div><div className="player-metrics"><div><div className="metric-label">{p.balance === 0 ? '当前积分 · 已归零' : '当前积分'}</div><div className={'balance ' + (p.balance === 0 ? 'zero' : '')}>{number(p.balance)}</div></div><div className="net"><div className="metric-label">净得分</div><div className={'net-value ' + (p.net < 0 ? 'negative' : '')}>{signed(p.net)}</div></div></div>{p.balance === 0 && ownerActive && <Button variant="secondary" className="refill" disabled={busy || sync !== 'ok'} onClick={() => openRefill(p.id)}>补分</Button>}</article>; })}</div></section>{ownerActive ? <section className="panel controls"><Button className="primary wide" onClick={openScore} disabled={busy || sync !== 'ok'}><Plus />记录积分</Button><div className="control-row"><Button variant="ghost" disabled={busy || !room.canUndo || sync !== 'ok'} onClick={() => ask('undo', '撤销最近一笔', '撤销最近一笔尚未撤销的记分或补分，所有人的页面会同步更新。')}><Undo2 />撤销</Button><Button variant="ghost" disabled={busy || room.players.length >= 12 || sync !== 'ok'} onClick={() => { setMemberName(''); setDialogError(''); setDraftVersion(room.version); setDialog('add'); }}><Users />加朋友</Button><Button variant="ghost" disabled={busy || sync !== 'ok'} onClick={() => ask('close', '结束这场活动？', '结束后积分和排名保留，不能再修改。')}>结束活动</Button></div></section> : <p className="viewer-note">{room.status === 'closed' ? '最终积分与排名已保存。' : '由创建者记分，积分会自动更新，无需手动刷新。'}</p>}<section className="panel history"><h2>记分记录</h2>{!room.events.length ? <p className="muted">还没有记分，大家从相同积分开始。</p> : <ol>{room.events.slice().reverse().map(e => <li key={e.id} className={e.undone ? 'undone' : ''}><div><strong>{e.text}{e.undone ? '（已撤销）' : ''}</strong>{e.details && <p>{e.details.map(d => d.name + ' ' + signed(d.delta)).join(' · ')}</p>}</div><time>{new Date(e.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</time></li>)}</ol>}<p className="muted history-limit">显示最近 200 条记录。</p></section></>}</>}
 <footer>积分仅用于娱乐排名，无兑换价值。</footer>
 <Dialog open={!!dialog} onOpenChange={open => { if (!open && !busy)
        setDialog(null); }}><DialogContent className="score-dialog" showCloseButton={!busy}><DialogHeader><DialogTitle>{dialog === 'score' ? '记录积分' : dialog === 'refill' ? `为 ${refillPlayer?.name || '朋友'} 补分` : dialog === 'share' ? '让朋友一起看' : dialog === 'manage' ? '保存你的管理入口' : '添加一位朋友'}</DialogTitle><DialogDescription>{dialog === 'score' ? '可填写积分变化，也可直接填写记分后的当前积分。两种方式都需保持总分不变。' : dialog === 'refill' ? '补分数量可与初始积分不同；计入累计补分，不增加净得分。' : dialog === 'share' ? '这个链接只能查看积分，朋友打开后会自动同步。' : dialog === 'manage' ? '管理链接可以修改积分，请只保存给自己。换手机或清除浏览器数据后，用它恢复管理权限。' : `新朋友将获得 ${number(room?.initial || 0)} 初始积分，净得分从 0 开始。`}</DialogDescription></DialogHeader>
 {dialog === 'score' && room && <form onSubmit={e => {
     e.preventDefault();
     if (canSaveScore) void submit('score', draftVersion, { changes });
 }}>
     <div className="score-modes" role="group" aria-label="记分方式">
         <Button type="button" variant={scoreMode === 'delta' ? 'default' : 'outline'} aria-pressed={scoreMode === 'delta'} disabled={busy} onClick={() => setScoreMode('delta')}>按变化量记分</Button>
         <Button type="button" variant={scoreMode === 'balance' ? 'default' : 'outline'} aria-pressed={scoreMode === 'balance'} disabled={busy} onClick={() => setScoreMode('balance')}>按当前分数记分</Button>
     </div>
     <p className="muted">{scoreMode === 'balance' ? '填入每个人现在实际持有的积分，未变化的人保留原值；归零请填 0。' : '选择加分或减分，再填写变化数量；未变化的人留空即可。'}</p>
     <div className="score-fields">{scorePlayers.map(p => {
         const delta = changes.find(c => c.id === p.id)?.delta ?? 0;
         return <div className="score-field" key={p.id}>
             <div className="score-person"><Label htmlFor={'score-' + p.id}>{p.name}</Label><span>原有 {number(p.balance)}</span></div>
             <div className={'score-input' + (scoreMode === 'balance' ? ' balance-input' : '')}>
                 {scoreMode === 'delta' && <>
                     <Button type="button" variant={draft[p.id]?.sign === 1 ? 'secondary' : 'outline'} aria-label={p.name + '加分'} aria-pressed={draft[p.id]?.sign === 1} disabled={busy} onClick={() => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], sign: 1 } }))}>＋</Button>
                     <Button type="button" variant={draft[p.id]?.sign === -1 ? 'secondary' : 'outline'} aria-label={p.name + '减分'} aria-pressed={draft[p.id]?.sign === -1} disabled={busy} onClick={() => setDraft(d => ({ ...d, [p.id]: { ...d[p.id], sign: -1 } }))}>−</Button>
                 </>}
                 <Input id={'score-' + p.id} inputMode="numeric" placeholder="0" autoComplete="off" value={scoreMode === 'balance' ? balances[p.id] ?? '' : draft[p.id]?.amount || ''} disabled={busy} onChange={e => {
                     const value = e.target.value;
                     if (scoreMode === 'balance') setBalances(d => ({ ...d, [p.id]: value }));
                     else setDraft(d => ({ ...d, [p.id]: { sign: d[p.id]?.sign || 1, amount: value } }));
                 }}/>
             </div>
             {validInputs && Number.isSafeInteger(delta) && <p className="score-preview">变化 {signed(delta)} · 记分后 {number(p.balance + delta)} 分</p>}
         </div>;
     })}</div>
     <p className={'delta-total ' + (deltaTotal !== 0 ? 'negative' : '')}>变化合计：{validInputs && Number.isFinite(deltaTotal) ? signed(deltaTotal) : '请填写整数'}</p>
     {validInputs && deltaTotal !== 0 && <p className="muted">总分还未对齐，请检查是否有漏记或误记。</p>}
     {scoreStale && <div className="error" role="alert">{retryScore ? '已读到更新后的积分。可再次保存确认上次操作的结果，不会重复记分；或载入最新积分重新填写。' : '积分已在其他操作中更新。请载入最新积分后重新填写，避免覆盖新的记录。'}<Button type="button" variant="outline" className="wide" disabled={busy} onClick={openScore}>载入最新积分并重新填写</Button></div>}
     {dialogError && <p className="error" role="alert">{dialogError}</p>}
     <Button className="primary wide" disabled={busy || !canSaveScore} type="submit">{busy ? '正在保存…' : '保存并同步'}</Button>
 </form>}
 {dialog === 'refill' && <form className="form-stack" onSubmit={e => {
     e.preventDefault();
     if (canSaveRefill) void submit('refill', draftVersion, { playerId: refillPlayerId, amount: refillValue });
 }}>
     <Label htmlFor="refill-amount">本次补多少分</Label>
     <Input id="refill-amount" inputMode="numeric" autoComplete="off" value={refillAmount} onChange={e => setRefillAmount(e.target.value)} disabled={busy} required/>
     <p className="muted">初始为 {number(room?.initial || 0)} 分，这次可填写不同数量。补分须为正整数，累计补分最多 1,000,000,000。</p>
     {validRefill && <p className="refill-preview">补分后为 <strong>{number(refillValue)}</strong> 分，净得分仍为 {signed(refillPlayer!.net)}。</p>}
     {dialogError && <p className="error" role="alert">{dialogError}</p>}
     <Button type="submit" className="primary wide" disabled={busy || !canSaveRefill}>{busy ? '正在保存…' : '确认补分并同步'}</Button>
 </form>}
 {(dialog === 'share' || dialog === 'manage') && <div className="form-stack"><Label htmlFor="share-link">{dialog === 'share' ? '查看链接' : '管理链接（仅自己保存）'}</Label><Textarea id="share-link" readOnly value={dialog === 'share' ? shareUrl : manageUrl} onFocus={e => e.target.select()}/>{dialogError && <p className="error" role="alert">{dialogError}</p>}<Button className="primary wide" onClick={() => void copy(dialog === 'share' ? shareUrl : manageUrl)}>{copyDone ? <><Check />已复制</> : dialog === 'share' ? '复制查看链接' : '复制管理链接'}</Button>{dialog === 'share' && room?.isOwner && <p className="muted">你的记分权限保存在当前浏览器。建议另外保存管理链接。</p>}</div>}
 {dialog === 'add' && <form className="form-stack" onSubmit={e => { e.preventDefault(); void submit('add', draftVersion, { name: memberName }); }}><Label htmlFor="member">朋友昵称</Label><Input id="member" value={memberName} onChange={e => setMemberName(e.target.value)} maxLength={12} required disabled={busy || !ready}/>{dialogError && <p className="error" role="alert">{dialogError}</p>}<Button type="submit" className="primary wide" disabled={busy || !ready}>添加并同步</Button></form>}
 </DialogContent></Dialog>
 <AlertDialog open={!!confirmation} onOpenChange={open => { if (!open && !busy)
        setConfirmation(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation?.title}</AlertDialogTitle><AlertDialogDescription>{confirmation?.description}</AlertDialogDescription></AlertDialogHeader>{dialogError && <p className="error" role="alert">{dialogError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy || !ready}>取消</AlertDialogCancel><AlertDialogAction disabled={busy || !ready} onClick={e => { e.preventDefault(); if (confirmation)
        void submit(confirmation.action, confirmation.version, confirmation.playerId ? { playerId: confirmation.playerId } : {}); }}>{busy ? '正在保存…' : '确认'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 </main>;
}

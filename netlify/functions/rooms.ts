import { getStore } from '@netlify/blobs';
import { makeHandler, type RoomRecord, type RoomStore } from '../../server/rooms';
// site store 跨部署保留；strong 确保读取刚写入的最新值。
// 平台凭据仅在云函数运行时可用，不会传到朋友的浏览器。
const storage: RoomStore = {
    async read(id) {
        const result = await getStore({ name: 'friends-score-v1', consistency: 'strong' })
            .getWithMetadata('rooms/' + id, { type: 'json' });
        if (!result) return null;
        if (!result.etag) throw new Error('Missing storage version');
        return { data: result.data as RoomRecord, etag: result.etag };
    },
    async write(id, value, condition) {
        const result = await getStore({ name: 'friends-score-v1', consistency: 'strong' })
            .setJSON('rooms/' + id, value, condition);
        return result.modified;
    },
};
export default makeHandler(storage);
export const config = {
    path: ['/api/rooms', '/api/rooms/:id', '/api/health'],
    rateLimit: { windowLimit: 600, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

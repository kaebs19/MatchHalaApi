/**
 * Shared Redis Client
 *
 * يُستخدم للبيانات التي تحتاج مشاركة بين الـ PM2 cluster instances:
 *   - Multi-Message Letter Buffer
 *   - Multi-Message Number Buffer (ممكن تحويلها مستقبلاً)
 *   - Rate-limit counters
 *
 * يعتمد على نفس Redis instance المستخدمة لـ Socket.IO adapter.
 */

const { createClient } = require('redis');

let client = null;
let connecting = null;

async function getClient() {
    if (client && client.isOpen) return client;
    if (connecting) return connecting;

    connecting = (async () => {
        try {
            const c = createClient({
                url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
            });
            c.on('error', (err) => {
                console.error('⚠️ Redis (shared) error:', err.message);
            });
            await c.connect();
            client = c;
            console.log('✅ Redis (shared client) connected');
            return c;
        } catch (err) {
            console.error('❌ Redis (shared client) connect failed:', err.message);
            return null;
        } finally {
            connecting = null;
        }
    })();

    return connecting;
}

/**
 * Get JSON value
 */
async function getJSON(key) {
    try {
        const c = await getClient();
        if (!c) return null;
        const raw = await c.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.error('redisClient.getJSON error:', err.message);
        return null;
    }
}

/**
 * Set JSON value with TTL (seconds)
 */
async function setJSON(key, value, ttlSeconds) {
    try {
        const c = await getClient();
        if (!c) return false;
        const json = JSON.stringify(value);
        if (ttlSeconds && ttlSeconds > 0) {
            await c.set(key, json, { EX: ttlSeconds });
        } else {
            await c.set(key, json);
        }
        return true;
    } catch (err) {
        console.error('redisClient.setJSON error:', err.message);
        return false;
    }
}

/**
 * Delete key
 */
async function del(key) {
    try {
        const c = await getClient();
        if (!c) return false;
        await c.del(key);
        return true;
    } catch (err) {
        console.error('redisClient.del error:', err.message);
        return false;
    }
}

/**
 * Atomic update with callback (read → modify → write)
 * Note: ليس فعلاً atomic — في حالة race conditions نادرة قد يحدث conflict.
 *       للحالات الحرجة، استخدم Redis WATCH/MULTI.
 */
async function updateJSON(key, ttlSeconds, updater) {
    const current = await getJSON(key);
    const updated = updater(current);
    if (updated === null || updated === undefined) {
        await del(key);
        return null;
    }
    await setJSON(key, updated, ttlSeconds);
    return updated;
}

module.exports = {
    getClient,
    getJSON,
    setJSON,
    del,
    updateJSON
};

// HalaChat Dashboard - Server-side Caching
// نظام التخزين المؤقت للبيانات

const NodeCache = require('node-cache');

// إنشاء instance للـ Cache
// stdTTL: الوقت الافتراضي لانتهاء الصلاحية (بالثواني)
// checkperiod: فترة التحقق من العناصر المنتهية (بالثواني)
const cache = new NodeCache({
    stdTTL: 300, // 5 دقائق
    checkperiod: 60, // تحقق كل دقيقة
    useClones: false // لتحسين الأداء
});

// مفاتيح الـ Cache
const CACHE_KEYS = {
    DASHBOARD_STATS: 'dashboard_stats',
    ALL_USERS: 'all_users',
    USER_BY_ID: (id) => `user_${id}`,
    CONVERSATIONS: 'conversations',
    CONVERSATION_BY_ID: (id) => `conversation_${id}`,
    CHAT_ROOMS: 'chat_rooms',
    CHAT_ROOM_BY_ID: (id) => `chat_room_${id}`,
    REPORTS: 'reports',
    SETTINGS: 'settings',
    MESSAGES_BY_CONV: (id) => `messages_conv_${id}`,
    MESSAGES_BY_ROOM: (id) => `messages_room_${id}`
};

// TTL مخصص لكل نوع بيانات (بالثواني)
const CACHE_TTL = {
    DASHBOARD_STATS: 60, // دقيقة واحدة - يتغير كثيراً
    ALL_USERS: 120, // دقيقتين
    USER: 300, // 5 دقائق
    CONVERSATIONS: 60, // دقيقة
    CHAT_ROOMS: 120, // دقيقتين
    REPORTS: 60, // دقيقة
    SETTINGS: 600, // 10 دقائق - نادراً ما يتغير
    MESSAGES: 30 // 30 ثانية - يتغير كثيراً
};

/**
 * الحصول على بيانات من الـ Cache
 * @param {string} key - مفتاح البيانات
 * @returns {any} البيانات أو undefined إذا لم تكن موجودة
 */
const get = (key) => {
    try {
        return cache.get(key);
    } catch (error) {
        console.error(`Cache GET Error [${key}]:`, error.message);
        return undefined;
    }
};

/**
 * تخزين بيانات في الـ Cache
 * @param {string} key - مفتاح البيانات
 * @param {any} value - البيانات المراد تخزينها
 * @param {number} ttl - وقت انتهاء الصلاحية (اختياري)
 * @returns {boolean} نجاح العملية
 */
const set = (key, value, ttl = undefined) => {
    try {
        if (ttl) {
            return cache.set(key, value, ttl);
        }
        return cache.set(key, value);
    } catch (error) {
        console.error(`Cache SET Error [${key}]:`, error.message);
        return false;
    }
};

/**
 * حذف بيانات من الـ Cache
 * @param {string} key - مفتاح البيانات
 * @returns {number} عدد العناصر المحذوفة
 */
const del = (key) => {
    try {
        return cache.del(key);
    } catch (error) {
        console.error(`Cache DEL Error [${key}]:`, error.message);
        return 0;
    }
};

/**
 * حذف بيانات بناءً على نمط المفتاح
 * @param {string} pattern - نمط المفتاح (مثل user_*)
 */
const delByPattern = (pattern) => {
    try {
        const keys = cache.keys();
        const regex = new RegExp(pattern.replace('*', '.*'));
        const matchingKeys = keys.filter(key => regex.test(key));
        matchingKeys.forEach(key => cache.del(key));
        return matchingKeys.length;
    } catch (error) {
        console.error(`Cache DEL Pattern Error [${pattern}]:`, error.message);
        return 0;
    }
};

/**
 * مسح كل الـ Cache
 */
const flush = () => {
    try {
        cache.flushAll();
        console.log('✅ تم مسح الـ Cache بالكامل');
    } catch (error) {
        console.error('Cache FLUSH Error:', error.message);
    }
};

/**
 * الحصول على إحصائيات الـ Cache
 * @returns {object} إحصائيات الـ Cache
 */
const getStats = () => {
    return cache.getStats();
};

/**
 * Middleware للـ Caching
 * @param {string} keyGenerator - دالة لتوليد المفتاح
 * @param {number} ttl - وقت انتهاء الصلاحية
 */
const cacheMiddleware = (keyGenerator, ttl = 300) => {
    return (req, res, next) => {
        const key = typeof keyGenerator === 'function'
            ? keyGenerator(req)
            : keyGenerator;

        const cachedData = get(key);

        if (cachedData) {
            console.log(`📦 Cache HIT: ${key}`);
            return res.json(cachedData);
        }

        console.log(`🔄 Cache MISS: ${key}`);

        // حفظ الـ res.json الأصلي
        const originalJson = res.json.bind(res);

        // تعديل res.json لتخزين البيانات في الـ Cache
        res.json = (data) => {
            if (res.statusCode === 200 && data.success !== false) {
                set(key, data, ttl);
            }
            return originalJson(data);
        };

        next();
    };
};

/**
 * إبطال الـ Cache عند التحديث
 * @param {string[]} keys - مفاتيح الـ Cache المراد إبطالها
 */
const invalidate = (...keys) => {
    keys.forEach(key => {
        if (key.includes('*')) {
            delByPattern(key);
        } else {
            del(key);
        }
    });
};

// دوال مساعدة للإبطال التلقائي
const invalidateUsers = () => {
    invalidate(CACHE_KEYS.ALL_USERS, CACHE_KEYS.DASHBOARD_STATS);
    delByPattern('user_*');
};

const invalidateConversations = () => {
    invalidate(CACHE_KEYS.CONVERSATIONS, CACHE_KEYS.DASHBOARD_STATS);
    delByPattern('conversation_*');
    delByPattern('messages_conv_*');
};

const invalidateChatRooms = () => {
    invalidate(CACHE_KEYS.CHAT_ROOMS);
    delByPattern('chat_room_*');
    delByPattern('messages_room_*');
};

const invalidateReports = () => {
    invalidate(CACHE_KEYS.REPORTS, CACHE_KEYS.DASHBOARD_STATS);
};

const invalidateSettings = () => {
    invalidate(CACHE_KEYS.SETTINGS);
};

module.exports = {
    cache,
    CACHE_KEYS,
    CACHE_TTL,
    get,
    set,
    del,
    delByPattern,
    flush,
    getStats,
    cacheMiddleware,
    invalidate,
    invalidateUsers,
    invalidateConversations,
    invalidateChatRooms,
    invalidateReports,
    invalidateSettings
};

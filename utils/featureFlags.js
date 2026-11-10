// مفاتيح الميزات للتطبيق — تُرسل في `features` بردّ GET /app/bootstrap
//
// المصدر: وثيقة Settings الوحيدة. كاش 60ث لأن bootstrap يُنادى عند كل فتح/عودة
// لكل مستخدم — لا قراءة Settings مع كل طلب.

const NodeCache = require('node-cache');
const Settings = require('../models/Settings');

const cache = new NodeCache({ stdTTL: 60 });
const CACHE_KEY = 'feature_settings';

async function loadFlagSettings() {
    let flags = cache.get(CACHE_KEY);
    if (!flags) {
        const doc = await Settings.findOne().select('gamesTab').lean();
        flags = { gamesTab: doc?.gamesTab || 'admins' };
        cache.set(CACHE_KEY, flags);
    }
    return flags;
}

function gamesVisibleFor(user, mode) {
    if (mode === 'all') return true;
    if (mode === 'admins') return user?.role === 'admin';
    return false;
}

// الميزات المفعّلة لهذا المستخدم — الفشل = كلها مطفأة (لا يُسقط bootstrap)
async function getFeaturesForUser(user) {
    try {
        const { gamesTab } = await loadFlagSettings();
        return { games: gamesVisibleFor(user, gamesTab) };
    } catch (error) {
        console.error('featureFlags error:', error.message);
        return { games: false };
    }
}

module.exports = { getFeaturesForUser, gamesVisibleFor };

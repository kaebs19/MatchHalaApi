// MatchHala - Mobile API Version Router
// يدير إصدارات API (v1, v2, v3) بدون تكرار الكود
// v1 = الكود الحالي (mobile.js)
// v2 = يرث v1 + يستبدل endpoints المتغيرة فقط
// v3 = يرث v2 + يستبدل endpoints المتغيرة فقط

const express = require('express');

// استيراد الإصدارات
const v1Router = require('../mobile');  // الكود الحالي كما هو
const v2Overrides = require('./v2');
const v3Overrides = require('./v3');

/**
 * إنشاء router مدمج — v2 overrides أولاً، ثم fallback لـ v1
 * Express يجرب أول router، إذا لم يجد match ينتقل للتالي
 */
function createVersionedRouter(overrides, fallback) {
    const router = express.Router();

    // Middleware: تسجيل إصدار API في req
    router.use((req, res, next) => {
        // يُستخرج من URL mount point في server.js
        const versionMatch = req.baseUrl.match(/\/v(\d+)\//);
        req.apiVersion = versionMatch ? parseInt(versionMatch[1]) : 1;
        next();
    });

    // Overrides أولاً (الـ endpoints الجديدة/المعدلة)
    if (overrides) {
        router.use(overrides);
    }

    // Fallback للإصدار السابق (الـ endpoints غير المتغيرة)
    router.use(fallback);

    return router;
}

// بناء الإصدارات
const v1 = v1Router;  // mobile.js الحالي بدون تغيير
const v2 = createVersionedRouter(v2Overrides, v1);
const v3 = createVersionedRouter(v3Overrides, v2);

module.exports = { v1, v2, v3 };

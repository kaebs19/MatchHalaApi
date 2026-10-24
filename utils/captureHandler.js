// يشغّل معالج مسار Express ويلتقط ما كتبه بدل إرساله للعميل.
// تستعمله نقاط bootstrap التي تجمع عدّة مسارات في نداء واحد دون تكرار منطقها.
// ⚠️ ردّ غير 200 أو خطأ يُرجع null — فشل جزء لا يُسقط الباقي.
function captureHandler(handler, req) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (payload) => {
            if (settled) return;
            settled = true;
            resolve(payload);
        };
        const fakeRes = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { done(this.statusCode === 200 ? payload : null); return this; },
            send(payload) { done(this.statusCode === 200 ? payload : null); return this; }
        };
        Promise.resolve(handler(req, fakeRes)).catch(() => done(null));
    });
}

module.exports = { captureHandler };

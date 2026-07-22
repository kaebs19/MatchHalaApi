// خدمة التحقق من اشتراكات Google Play عبر Google Play Developer API (androidpublisher v3).
// نستخدم subscriptionsv2.get — يحتاج purchaseToken فقط (متوافق مع base plans/offers في Billing v5+).
//
// المصادقة: حساب خدمة (Service Account) بصلاحية androidpublisher.
// يجب دعوة بريد الحساب في Google Play Console → Users & permissions ومنحه
// صلاحية "View financial data" على الأقل، وربط مشروع GCP بحساب المطوّر.
//
// مصدر بيانات الاعتماد (بالترتيب):
//   1) متغيّر البيئة GOOGLE_PLAY_SA_PATH → مسار ملف JSON مخصص للاشتراكات
//   2) config/playServiceAccount.json (إن وُجد)
//   3) config/serviceAccount.json (نفس حساب Firebase — يعمل فقط إن مُنح صلاحية Play)

const path = require('path');
const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');

const ANDROID_PUBLISHER_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

let authClientPromise = null;

/** يحدّد ملف بيانات الاعتماد المتاح. */
function resolveKeyFile() {
    const candidates = [
        process.env.GOOGLE_PLAY_SA_PATH,
        path.join(__dirname, '..', 'config', 'playServiceAccount.json'),
        path.join(__dirname, '..', 'config', 'serviceAccount.json'),
    ].filter(Boolean);

    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch (_) { /* تجاهل */ }
    }
    return null;
}

/** يُنشئ (مرّة واحدة) عميل مصادقة مخوّل لـ androidpublisher. */
function getAuthClient() {
    if (!authClientPromise) {
        const keyFile = resolveKeyFile();
        if (!keyFile) {
            return Promise.reject(new Error('لا يوجد ملف حساب خدمة لـ Google Play (GOOGLE_PLAY_SA_PATH أو config/playServiceAccount.json)'));
        }
        const auth = new GoogleAuth({ keyFile, scopes: [ANDROID_PUBLISHER_SCOPE] });
        authClientPromise = auth.getClient();
    }
    return authClientPromise;
}

/**
 * يجلب حالة اشتراك من Google Play عبر purchaseToken.
 * @returns {Promise<object>} جسم الرد كما توثّقه Google (SubscriptionPurchaseV2)
 * @throws إذا فشل الطلب (توكن غير صالح، صلاحيات ناقصة، إلخ)
 */
async function getSubscriptionV2(packageName, purchaseToken) {
    const client = await getAuthClient();
    const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const resp = await client.request({ url, method: 'GET' });
    return resp.data;
}

module.exports = { getSubscriptionV2 };

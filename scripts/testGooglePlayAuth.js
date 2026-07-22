/**
 * سكربت تشخيص لربط Google Play Developer API.
 *
 * الاستخدام:
 *   node scripts/testGooglePlayAuth.js
 *      → يتأكد فقط أن حساب الخدمة يحصل على access token بصلاحية androidpublisher.
 *
 *   node scripts/testGooglePlayAuth.js <packageName> <purchaseToken>
 *      → يجرّب استدعاء فعلي لـ subscriptionsv2.get على شراء حقيقي.
 *
 * يكشف مبكّراً مشاكل الربط قبل الاعتماد على شراء فعلي:
 *   - عدم وجود ملف حساب الخدمة
 *   - عدم تفعيل Google Play Android Developer API على المشروع
 *   - عدم منح حساب الخدمة صلاحية مالية في Play Console
 */

require('dotenv').config();
const { GoogleAuth } = require('google-auth-library');
const path = require('path');
const fs = require('fs');

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

function resolveKeyFile() {
    const candidates = [
        process.env.GOOGLE_PLAY_SA_PATH,
        path.join(__dirname, '..', 'config', 'playServiceAccount.json'),
        path.join(__dirname, '..', 'config', 'serviceAccount.json'),
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

(async () => {
    const keyFile = resolveKeyFile();
    if (!keyFile) {
        console.error('❌ لا يوجد ملف حساب خدمة (GOOGLE_PLAY_SA_PATH / config/playServiceAccount.json / config/serviceAccount.json)');
        process.exit(1);
    }
    console.log('🔑 ملف الاعتماد:', keyFile);

    let clientEmail = '(غير معروف)';
    try {
        clientEmail = require(keyFile).client_email || clientEmail;
    } catch (_) { /* تجاهل */ }
    console.log('📧 حساب الخدمة:', clientEmail);

    // 1) اختبار المصادقة (الحصول على access token)
    try {
        const auth = new GoogleAuth({ keyFile, scopes: [SCOPE] });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        if (!token || !token.token) throw new Error('لم يُرجع access token');
        console.log('✅ نجحت المصادقة — تم الحصول على access token بصلاحية androidpublisher');
    } catch (e) {
        console.error('❌ فشلت المصادقة:', e.message);
        console.error('   تحقّق أن Google Play Android Developer API مُفعّل على مشروع حساب الخدمة.');
        process.exit(1);
    }

    // 2) اختبار استدعاء فعلي (اختياري)
    const [, , packageName, purchaseToken] = process.argv;
    if (packageName && purchaseToken) {
        try {
            const { getSubscriptionV2 } = require('../services/googlePlayService');
            const data = await getSubscriptionV2(packageName, purchaseToken);
            console.log('✅ نجح استدعاء subscriptionsv2.get:');
            console.log('   subscriptionState:', data.subscriptionState);
            console.log('   expiryTime:', data.lineItems?.[0]?.expiryTime);
        } catch (e) {
            console.error('❌ فشل استدعاء subscriptionsv2.get:', e?.response?.data || e.message);
            console.error('   إن كان الخطأ 401/403: تأكد من منح حساب الخدمة صلاحية "View financial data" في Play Console.');
            process.exit(1);
        }
    } else {
        console.log('ℹ️  لاختبار شراء فعلي: node scripts/testGooglePlayAuth.js <packageName> <purchaseToken>');
    }

    process.exit(0);
})();

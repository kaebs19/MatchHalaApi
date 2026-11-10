// التحقق من مشتريات أبل (StoreKit 2) على السيرفر.
//
// ⚠️ كان POST /subscription/verify يفعّل هلا+ لأي transactionId يرسله العميل بلا أي تحقق (TODO قديم):
//    طلب واحد برقم وهمي = اشتراك مجاني. الآن:
//    - signedTransaction (JWS من StoreKit 2): يُتحقَّق من توقيعه محلياً بسلسلة شهادات أبل الجذرية
//      (config/apple-root-certs) — لا يحتاج مفتاحاً سرّياً. نقرأ منه المنتج وتاريخ الانتهاء الحقيقي.
//    - transactionId وحده (نسخ أقدم من التطبيق): يُتحقَّق عبر App Store Server API إن ضُبط مفتاحها
//      (APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID / APPLE_IAP_KEY_PATH)، وإلا يُرفض حين APPLE_IAP_ENFORCE=1.

const fs = require('fs');
const path = require('path');

const BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.app.hala';
const APP_APPLE_ID = Number(process.env.APPLE_APP_ID || 1369295351);

const PRODUCT_PLANS = {
    'com.halachat.premium.weekly': 'weekly',
    'com.halachat.premium.monthly': 'monthly',
    'com.halachat.premium.quarterly': 'quarterly'
};

let lib = null;
let verifiers = null;

function loadLib() {
    if (!lib) lib = require('@apple/app-store-server-library');
    return lib;
}

function rootCertificates() {
    const dir = path.join(__dirname, '..', 'config', 'apple-root-certs');
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.cer'))
        .map(f => fs.readFileSync(path.join(dir, f)));
}

function getVerifiers() {
    if (verifiers) return verifiers;
    const { SignedDataVerifier, Environment } = loadLib();
    const certs = rootCertificates();
    // الإنتاج يشترط appAppleId؛ Sandbox (TestFlight/Xcode) لا
    verifiers = [
        new SignedDataVerifier(certs, true, Environment.PRODUCTION, BUNDLE_ID, APP_APPLE_ID),
        new SignedDataVerifier(certs, true, Environment.SANDBOX, BUNDLE_ID)
    ];
    return verifiers;
}

/**
 * يتحقق من JWS معاملة StoreKit 2 ويُرجع الحمولة المفكوكة أو يرمي.
 * @returns {Promise<{transactionId, originalTransactionId, productId, plan, expiresDate: Date|null, revoked: boolean, environment}>}
 */
async function verifySignedTransaction(jws) {
    if (typeof jws !== 'string' || jws.split('.').length !== 3) {
        throw new Error('INVALID_JWS');
    }
    let lastError;
    for (const verifier of getVerifiers()) {
        try {
            const t = await verifier.verifyAndDecodeTransaction(jws);
            if (t.bundleId !== BUNDLE_ID) throw new Error('BUNDLE_MISMATCH');
            return {
                transactionId: String(t.transactionId),
                originalTransactionId: String(t.originalTransactionId || t.transactionId),
                productId: t.productId,
                plan: PRODUCT_PLANS[t.productId] || null,
                expiresDate: t.expiresDate ? new Date(t.expiresDate) : null,
                revoked: Boolean(t.revocationDate),
                environment: t.environment
            };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('VERIFICATION_FAILED');
}

/** App Store Server API (للنسخ القديمة التي ترسل transactionId فقط) — null إن لم يُضبط المفتاح */
function apiClient(environmentName) {
    const keyId = process.env.APPLE_IAP_KEY_ID;
    const issuerId = process.env.APPLE_IAP_ISSUER_ID;
    const keyPath = process.env.APPLE_IAP_KEY_PATH;
    if (!keyId || !issuerId || !keyPath || !fs.existsSync(keyPath)) return null;
    const { AppStoreServerAPIClient, Environment } = loadLib();
    return new AppStoreServerAPIClient(
        fs.readFileSync(keyPath, 'utf8'), keyId, issuerId, BUNDLE_ID,
        environmentName === 'sandbox' ? Environment.SANDBOX : Environment.PRODUCTION
    );
}

function isApiConfigured() {
    return apiClient('production') !== null;
}

/** يجلب المعاملة من أبل برقمها ثم يتحقق من توقيعها — يرمي إن لم توجد */
async function verifyTransactionId(transactionId) {
    let lastError;
    for (const env of ['production', 'sandbox']) {
        const client = apiClient(env);
        if (!client) throw new Error('API_NOT_CONFIGURED');
        try {
            const info = await client.getTransactionInfo(String(transactionId));
            if (info && info.signedTransactionInfo) {
                return verifySignedTransaction(info.signedTransactionInfo);
            }
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('TRANSACTION_NOT_FOUND');
}

module.exports = {
    verifySignedTransaction,
    verifyTransactionId,
    isApiConfigured,
    PRODUCT_PLANS,
    BUNDLE_ID
};

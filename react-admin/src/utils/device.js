// اسم الجهاز المقروء من معرّف أبل (iPhone15,2 ← iPhone 14 Pro). المعرّف الخام يبقى في التلميح دائماً،
// وأي معرّف غير معروف يُعرض كما هو — لا تخمين.
const IPHONE_MODELS = {
    'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max', 'iPhone12,8': 'iPhone SE 2',
    'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12', 'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
    'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13', 'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
    'iPhone14,6': 'iPhone SE 3', 'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
    'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max', 'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus',
    'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
    'iPhone17,1': 'iPhone 16 Pro', 'iPhone17,2': 'iPhone 16 Pro Max', 'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus', 'iPhone17,5': 'iPhone 16e',
    'iPhone18,1': 'iPhone 17 Pro', 'iPhone18,2': 'iPhone 17 Pro Max', 'iPhone18,3': 'iPhone 17', 'iPhone18,4': 'iPhone Air'
};

export function deviceSummary(info) {
    if (!info || !info.platform) return null;
    const p = String(info.platform).toLowerCase();
    const raw = info.deviceModel || null;
    if (p === 'ios') {
        return {
            kind: 'ios', icon: '📱',
            name: (raw && IPHONE_MODELS[raw]) || (raw && /^iPad/.test(raw) ? 'iPad' : raw) || 'iPhone',
            os: info.osVersion ? `iOS ${info.osVersion}` : null,
            app: info.appVersion ? `v${info.appVersion}` : null,
            raw
        };
    }
    if (p === 'android') {
        return { kind: 'android', icon: '🤖', name: raw || 'Android', os: info.osVersion ? `Android ${info.osVersion}` : null,
            app: info.appVersion ? `v${info.appVersion}` : null, raw };
    }
    if (p === 'web') return { kind: 'web', icon: '🌐', name: 'متصفح', os: null, app: null, raw };
    return { kind: 'other', icon: '💻', name: info.platform, os: info.osVersion || null, app: info.appVersion ? `v${info.appVersion}` : null, raw };
}

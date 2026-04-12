// Apple Push Notification Service (APNs) Configuration
// ملف إعدادات إشعارات Apple

module.exports = {
    // معلومات مفتاح APNs
    apns: {
        // Key ID من Apple Developer
        keyId: '43J3HP6K23',

        // Team ID من Apple Developer
        teamId: 'ZN3Z5KRWM7',

        // Bundle ID للتطبيق
        bundleId: 'com.app.hala',

        // مسار ملف المفتاح .p8
        keyPath: __dirname + '/AuthKey_43J3HP6K23.p8',

        // البيئة (development أو production)
        production: process.env.NODE_ENV === 'production',

        // الخادم
        // development: api.sandbox.push.apple.com:443
        // production: api.push.apple.com:443
        server: process.env.NODE_ENV === 'production'
            ? 'api.push.apple.com:443'
            : 'api.sandbox.push.apple.com:443'
    },

    // معلومات المطور
    developer: {
        name: 'Mohammed Saleh Sablal',
        teamId: 'ZN3Z5KRWM7'
    }
};

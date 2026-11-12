// 🔁 حساب جديد من المتصفح بعنوان IP استعمله جهاز محظور مؤخراً ← يُرفع في «الحسابات الجديدة» (إخفاء 3 أيام + السبب).
//
// السبب: المتصفح بلا معرّف جهاز، فصاحب الجهاز المحظور يسجّل بجوجل/أبل من الموقع (١٢ نوفمبر ٢٠٢٦: «ولد نوف»).
// لا حظر تلقائي — IP إشارة لا دليل: IPv4 الجوال (CGNAT) يتشاركه آلاف، فنافذته ساعتان؛ IPv6 لكل جهاز تقريباً فنافذته 7 أيام.
// المصادر: آخر IP لحسابات على أجهزة محظورة (lastIP مفهرس) + محاولات الأجهزة المحظورة المرفوضة (rejectedAttempts.ip).
// لا يرمي أبداً — فشله لا يمنع التسجيل.

const HOUR = 60 * 60 * 1000;

async function flagIfBannedDeviceIp(user, ip) {
    try {
        if (!user || !ip || typeof ip !== 'string') return false;
        const User = require('../models/User');
        const BannedDevice = require('../models/BannedDevice');
        const isV6 = ip.includes(':');
        const since = new Date(Date.now() - (isV6 ? 7 * 24 * HOUR : 2 * HOUR));

        // (١) محاولة مرفوضة من جهاز محظور بنفس العنوان (المجموعة صغيرة ~1200)
        let match = await BannedDevice.findOne({
            isActive: true,
            rejectedAttempts: { $elemMatch: { ip, attemptedAt: { $gte: since } } }
        }).select('_id originalUserId').lean();
        let via = 'محاولة مرفوضة من جهاز محظور';

        // (٢) حساب على جهاز محظور دخل مؤخراً بنفس العنوان
        if (!match) {
            const sameIp = await User.find({ _id: { $ne: user._id }, lastIP: ip, lastLogin: { $gte: since } })
                .select('+keychainToken').limit(50).lean();
            const kcs = [...new Set(sameIp.map(u => u.keychainToken).filter(Boolean))];
            if (kcs.length) {
                match = await BannedDevice.findOne({ isActive: true, keychainToken: { $in: kcs } })
                    .select('_id originalUserId').lean();
                via = 'حساب على جهاز محظور';
            }
        }
        if (!match) return false;

        const orig = match.originalUserId ? await User.findById(match.originalUserId).select('name').lean() : null;
        const now = new Date();
        await User.updateOne({ _id: user._id }, {
            $set: {
                'newcomer.status': 'flagged',
                'newcomer.flaggedAt': now,
                'newcomer.flaggedReason': `🌐 تسجيل من الويب بعنوان IP ${via}${orig ? ` (${orig.name})` : ''} — راجع «الحسابات المرتبطة»`.slice(0, 500)
            }
        });
        console.log(`[webSignupLink] flagged ${user._id} via ${via} (device ${match._id})`);
        return true;
    } catch (err) {
        console.error('[webSignupLink] failed:', err.message);
        return false;
    }
}

module.exports = { flagIfBannedDeviceIp };

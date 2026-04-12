/**
 * Spam Detection Middleware v4 (2026-04-06)
 * نظام كشف السبام الاحترافي لتطبيق تعارف
 * 
 * المبدأ: حماية المستخدمين الحقيقيين أولاً ثم كشف السبام
 * رسائل أقل من 8 أحرف + whitelist = OK فوراً
 * كلمات مصنّفة (عالي/متوسط/منخفض) + سياق (حساب جديد/قديم/رد)
 * حظر >= 70 | تحذير >= 40 | أول 5 = تحذير بدون بلاغ
 * تصعيد بعد 10+ بلاغات + cooldown 6 ساعات
 */

const FlaggedMessage = require('../models/FlaggedMessage');
const SpamReport = require('../models/SpamReport');
const User = require('../models/User');
const BannedDevice = require('../models/BannedDevice');
const NodeCache = require('node-cache');
const messageCache = new NodeCache({ stdTTL: 1800 });

// Whitelist
const SAFE_MESSAGES = new Set([
    'كيفك','كيف حالك','هلا','هاي','اهلا','اهلين','مرحبا',
    'السلام عليكم','وعليكم السلام','صباح الخير','مساء الخير',
    'تمام','اي','لا','اه','اها','بخير','الحمدلله',
    'كم عمرك','من وين','وانت','وانتي','وينك','اخبارك',
    'عادي','ان شاء الله','الله يسعدك','شكرا','الو',
    'hi','hello','hey','how are you','fine','thanks','ok','yes','no','bye',
]);

const KEYWORDS_HIGH = ['escort','booking','vip service','عرض خاص','سعر خاص','خدمة vip','حجز خاص','مساج','مساچ','massage','تدليك','مسااج'];
const KEYWORDS_MEDIUM = ['واتساب','واتس','whatsapp','whats app','واتسب','تواصل واتس','رقم الواتس','كلمني واتس','سناب','سنابي','snapchat','انستقرام','تلقرام','telegram'];
const KEYWORDS_LOW = ['رقمي','رقم','نمبر'];
const SUSPICIOUS_LINKS = ['t.me/','wa.me/','bit.ly/','tinyurl','snapchat.com','instagram.com'];
const PHONE_PATTERNS = [/0[5][0-9 -]{7,12}/, /[+]?966[0-9 -]{8,12}/, /[+]?971[0-9 -]{8,12}/, /[+]?20[0-9 -]{9,12}/, /[+]?962[0-9 -]{8,12}/, /[0-9]{10,14}/];

function checkMessage(content, senderId, context) {
    context = context || {};
    var normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    var score = 0, reasons = [];

    if (SAFE_MESSAGES.has(normalized)) return {isSpam:false,isWarning:false,score:0,reasons:[]};
    if (normalized.length < 8) return {isSpam:false,isWarning:false,score:0,reasons:[]};

    var highM = KEYWORDS_HIGH.filter(function(k){return normalized.includes(k)});
    var medM = KEYWORDS_MEDIUM.filter(function(k){return normalized.includes(k)});
    var lowM = KEYWORDS_LOW.filter(function(k){return normalized.includes(k)});
    if (highM.length > 0) { score += 25 + (highM.length-1)*15; reasons.push('keywords_high: '+highM.join(', ')); }
    if (medM.length > 0) { score += 20 + (medM.length-1)*10; reasons.push('keywords_med: '+medM.join(', ')); }
    if (lowM.length > 0) { score += 10; reasons.push('keywords_low'); }
    var hasKW = highM.length + medM.length > 0;

    var hasPhone = false;
    for (var i=0; i<PHONE_PATTERNS.length; i++) {
        if (PHONE_PATTERNS[i].test(content)) { hasPhone=true; score += hasKW ? 35 : 30; reasons.push('phone_number'); break; }
    }

    var suspLink = SUSPICIOUS_LINKS.some(function(l){return normalized.includes(l)});
    if (suspLink) { score += 40; reasons.push('suspicious_link'); }
    else if (/https?:\/\/[^\s]+/gi.test(content)) { score += 25; reasons.push('url_detected'); }

    if (normalized.length >= 10) {
        var ck = 'msg_'+senderId;
        var sm = messageCache.get(ck) || [];
        var sc = sm.filter(function(m){return m===normalized}).length;
        if (sc >= 5) { score += 35; reasons.push('repeated_'+(sc+1)+'_times'); }
        sm.push(normalized); messageCache.set(ck, sm);

        var fk = 'flood_'+senderId;
        var ts = messageCache.get(fk) || [];
        var now = Date.now();
        ts = ts.filter(function(t){return now-t<60000});
        ts.push(now); messageCache.set(fk, ts);
        if (ts.length > 25) { score += 30; reasons.push('flood_'+ts.length+'_per_min'); }
    }

    if (context.accountAgeMinutes !== undefined && context.accountAgeMinutes < 60) { score += 15; reasons.push('new_account'); }
    if (context.isReply) { score -= 15; reasons.push('reply_discount'); }
    if (context.accountAgeDays !== undefined && context.accountAgeDays > 30) { score -= 10; reasons.push('trusted_account'); }
    score = Math.max(0, score);

    return {isSpam: score>=70, isWarning: score>=40 && score<70, score: score, reasons: reasons};
}

function spamCheckMiddleware(req, res, next) {
    // ⚠️ نظام كشف السبام التلقائي معطّل (2026-04-06)
    // السبب: تسبب في إيقاف مستخدمين حقيقيين بسبب رسائل عادية
    // البديل: الاعتماد على البلاغات اليدوية + معالجة الأدمن
    return next();
}


async function handleAutoSuspension(userId) {
    // ⚠️ معطّل تماماً (2026-04-07) — لا يوجد تعليق تلقائي
    return;
    // كود قديم محفوظ:
    var recentCount = await SpamReport.countDocuments({ userId: userId, createdAt: { $gte: new Date(Date.now() - 86400000) } });
    if (recentCount < 10) return;
    var user = await User.findById(userId).select('suspension').lean();
    if (user && user.suspension && user.suspension.suspendedAt) {
        var h = (Date.now() - new Date(user.suspension.suspendedAt).getTime()) / 3600000;
        if (h < 6) return;
    }
    var esc = require('./escalation');
    var r = await esc.escalateUser(userId, 'سبام متكرر (' + recentCount + ' بلاغ/24h)', 'auto');
    if (r.success) console.log('Escalation: ' + r.message);
}

async function banUserDevice(userId, reason) {
    var reports = await SpamReport.find({ userId: userId }).sort({ createdAt: -1 }).limit(1);
    var lr = reports[0];
    if (lr && (lr.deviceFingerprint || lr.keychainToken)) {
        await BannedDevice.findOneAndUpdate(
            { $or: [{ deviceFingerprint: lr.deviceFingerprint }, { keychainToken: lr.keychainToken }] },
            { deviceFingerprint: lr.deviceFingerprint, keychainToken: lr.keychainToken, originalUserId: userId, reason: reason, bannedBy: 'spam_system', isActive: true },
            { upsert: true, new: true }
        );
    }
}

module.exports = { checkMessage: checkMessage, spamCheckMiddleware: spamCheckMiddleware, handleAutoSuspension: handleAutoSuspension, banUserDevice: banUserDevice };

// نقل تقييدات الحساب المحذوف إلى حساب صاحبه الجديد.
//
// الثغرة: المستخدم المقيَّد (منع تغيير الاسم/الصورة، تقييد مراسلة، تعليق، مخالفات…) يحذف حسابه
// ويسجّل من جديد فيبدأ نظيفاً. لا نمنع الحذف (شرط أبل/جوجل وحق المستخدم)، بل:
//   captureOnDelete  — قبل الحذف: لقطة بالتقييدات السارية + معرّفات مُجزّأة (HMAC) ← RestrictionCarryover
//   applyToUser      — عند التسجيل/الدخول: حساب أُنشئ بعد الحذف ويطابق أي معرّف ← تُطبَّق اللقطة
//                      (بمواعيد انتهائها الأصلية) ويُرفع الحساب في «الحسابات الجديدة» للمراجعة.
// المعرّفات: بصمة الجهاز، Keychain (يبقى بعد حذف التطبيق)، vendorId، البريد، ومعرّف أبل/جوجل/فيسبوك.
// ⚠️ «إخفاء البريد» في أبل يعطي بريد relay — لكن معرّف أبل (sub) ثابت لنفس Apple ID ولنفس فريق المطوّر
//    حتى بعد حذف الحساب وإيقاف «تسجيل الدخول بأبل»، فيطابق. وApple ID مختلف ← تطابقه بصمة الجهاز/Keychain.

const crypto = require('crypto');

const RETENTION_DAYS = 90;          // = وعد صفحة «حذف الحساب» لسجلّات مكافحة الاحتيال
const MIN_RETENTION_DAYS = 30;      // حتى لو انتهت التقييدات قريباً — للمخالفات والتحذيرات الحديثة
const DAY = 24 * 60 * 60 * 1000;

const PEPPER = process.env.CARRYOVER_PEPPER || process.env.JWT_SECRET || 'matchhala-carryover';
const h = (kind, value) => {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return null;
    return crypto.createHmac('sha256', PEPPER).update(`${kind}:${v}`).digest('hex');
};

function identityHashes(u, extra = {}) {
    const list = [
        h('email', u.email),
        h('apple', u.appleId),
        h('google', u.googleId),
        h('facebook', u.facebookId),
        h('device', extra.deviceFingerprint || u.deviceFingerprint),
        h('keychain', extra.deviceToken || u.keychainToken),
        h('vendor', extra.vendorId || u.vendorId)
    ];
    return [...new Set(list.filter(Boolean))];
}

const isActive = (blocked, until, now) => blocked && (!until || new Date(until) > now);
const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'دائم');

// لقطة بالتقييدات السارية فقط — null إن لم يكن هناك ما يُنقل
function buildSnapshot(u, now = new Date()) {
    const r = u.restrictions || {};
    const snap = {};
    const summary = [];
    let latestEnd = 0;
    let permanent = false;
    const track = (until) => {
        if (!until) permanent = true;
        else latestEnd = Math.max(latestEnd, new Date(until).getTime());
    };

    for (const [key, label] of [['name', 'منع تغيير الاسم'], ['photo', 'منع تغيير الصورة'], ['bio', 'منع تعديل النبذة']]) {
        const blocked = r[`${key}Blocked`];
        const until = r[`${key}BlockedUntil`];
        if (isActive(blocked, until, now)) {
            snap[`${key}Blocked`] = { until: until || null, permanent: !until, reason: r[`${key}BlockedReason`] || null };
            summary.push(`${label} (${fmt(until)})`);
            track(until);
        }
    }

    if (isActive(r.messagingRestricted, r.messagingRestrictedUntil, now)) {
        snap.messaging = { until: r.messagingRestrictedUntil || null, level: r.messagingRestrictedLevel || null, reason: r.restrictionReason || null };
        summary.push(`تقييد المراسلة ${r.messagingRestrictedLevel === 'new_only' ? '(المحادثات الجديدة)' : ''} (${fmt(r.messagingRestrictedUntil)})`);
        track(r.messagingRestrictedUntil);
    }

    const hd = u.hidden || {};
    if (isActive(hd.isHidden, hd.hiddenUntil, now)) {
        snap.hidden = { until: hd.hiddenUntil || null, permanent: !hd.hiddenUntil, reason: hd.reason || null };
        summary.push(`إخفاء من الاكتشاف (${fmt(hd.hiddenUntil)})`);
        track(hd.hiddenUntil);
    }

    const sp = u.suspension || {};
    if (isActive(sp.isSuspended, sp.suspendedUntil, now)) {
        snap.suspension = { until: sp.suspendedUntil || null, reason: sp.reason || null, level: sp.level || 0 };
        summary.push(`تعليق الحساب (${fmt(sp.suspendedUntil)})`);
        track(sp.suspendedUntil);
    }

    if (u.storyBan && u.storyBan.until && new Date(u.storyBan.until) > now) {
        snap.storyBan = { until: u.storyBan.until, reason: u.storyBan.reason || null };
        summary.push(`منع نشر القصص (${fmt(u.storyBan.until)})`);
        track(u.storyBan.until);
    }

    const bw = u.bannedWords || {};
    if (bw.isBanned) {
        snap.bannedWordsBan = { reason: bw.banReason || null };
        summary.push('حظر بسبب الكلمات المحظورة');
        permanent = true;
    }

    // سجلّ حديث يُبنى عليه التصعيد التالي — لا عقوبة بذاته
    const w = u.warnings || {};
    if (w.level > 0 && w.lastWarningAt && now - new Date(w.lastWarningAt) < 30 * DAY) {
        snap.warningsLevel = w.level;
        summary.push(`تحذيرات (المستوى ${w.level})`);
    }
    const ep = u.externalPromo || {};
    if ((ep.violations > 0 && ep.lastViolationAt && now - new Date(ep.lastViolationAt) < 7 * DAY)
        || (ep.lockCount > 0 && ep.lastLockAt && now - new Date(ep.lastLockAt) < 7 * DAY)) {
        snap.externalPromo = {
            violations: ep.violations || 0, lastViolationAt: ep.lastViolationAt || null,
            lockCount: ep.lockCount || 0, lastLockAt: ep.lastLockAt || null
        };
        const parts = [];
        if (ep.violations > 0) parts.push(`${ep.violations} مخالفات`);
        if (ep.lockCount > 0) parts.push(`${ep.lockCount} إيقافات`);
        summary.push(`سجلّ مشاركة حسابات خارجية: ${parts.join(' و')}`);
    }

    if (summary.length === 0) return null;

    const minEnd = now.getTime() + MIN_RETENTION_DAYS * DAY;
    const maxEnd = now.getTime() + RETENTION_DAYS * DAY;
    const expiresAt = new Date(permanent ? maxEnd : Math.min(maxEnd, Math.max(minEnd, latestEnd)));
    return { snapshot: snap, summary, expiresAt };
}

/** قبل حذف الحساب. لا يرمي أبداً — فشله لا يمنع الحذف. */
async function captureOnDelete(userId) {
    try {
        const User = require('../models/User');
        const RestrictionCarryover = require('../models/RestrictionCarryover');
        const u = await User.findById(userId)
            .select('+deviceFingerprint +keychainToken +vendorId email appleId googleId facebookId restrictions hidden suspension storyBan bannedWords warnings externalPromo')
            .lean();
        if (!u) return null;
        const built = buildSnapshot(u);
        if (!built) return null;
        const hashes = identityHashes(u);
        if (hashes.length === 0) return null;
        const doc = await RestrictionCarryover.create({
            identityHashes: hashes,
            deletedAt: new Date(),
            snapshot: built.snapshot,
            summary: built.summary,
            expiresAt: built.expiresAt
        });
        return doc;
    } catch (err) {
        console.error('[carryover] capture failed:', err.message);
        return null;
    }
}

/** هل على هذا الحساب تقييدات سارية ستنتقل؟ — لنصّ شاشة الحذف */
function pendingCarryoverSummary(userDoc) {
    const built = buildSnapshot(userDoc || {});
    return built ? built.summary : [];
}

// تطبيق اللقطة: الأشدّ يغلب (لا نخفّف تقييداً قائماً على الحساب الجديد)
function laterOf(a, b) {
    if (a === null || b === null) return null;     // null = دائم
    if (!a) return b;
    if (!b) return a;
    return new Date(a) > new Date(b) ? a : b;
}

/**
 * عند التسجيل/الدخول. يطبّق على الحسابات المُنشأة بعد الحذف فقط (لا يمسّ حساب فرد آخر من العائلة
 * على نفس الجهاز كان موجوداً قبله). لا يرمي.
 * @returns {Promise<boolean>} هل طُبّق شيء
 */
async function applyToUser(userOrId, extra = {}) {
    try {
        const User = require('../models/User');
        const RestrictionCarryover = require('../models/RestrictionCarryover');
        const id = userOrId && userOrId._id ? userOrId._id : userOrId;
        const u = await User.findById(id)
            .select('+deviceFingerprint +keychainToken +vendorId email appleId googleId facebookId createdAt restrictions hidden suspension storyBan bannedWords warnings externalPromo newcomer')
            .lean();
        if (!u) return false;
        const hashes = identityHashes(u, extra);
        if (hashes.length === 0) return false;

        const now = new Date();
        const records = await RestrictionCarryover.find({
            identityHashes: { $in: hashes },
            expiresAt: { $gt: now },
            deletedAt: { $lte: u.createdAt || now },
            appliedTo: { $ne: u._id }
        }).sort({ deletedAt: -1 }).limit(5).lean();
        if (records.length === 0) return false;

        const set = {};
        const r = u.restrictions || {};
        for (const rec of records) {
            const s = rec.snapshot || {};
            for (const key of ['name', 'photo', 'bio']) {
                const b = s[`${key}Blocked`];
                if (!b || (!b.permanent && b.until && new Date(b.until) <= now)) continue;
                const until = b.permanent ? null : b.until;
                const current = r[`${key}Blocked`] ? (r[`${key}BlockedUntil`] || null) : undefined;
                set[`restrictions.${key}Blocked`] = true;
                set[`restrictions.${key}BlockedUntil`] = current === undefined ? until : laterOf(current, until);
                set[`restrictions.${key}BlockedReason`] = b.reason || 'تقييد سابق على حساب محذوف';
            }
            if (s.messaging && (!s.messaging.until || new Date(s.messaging.until) > now)) {
                set['restrictions.messagingRestricted'] = true;
                set['restrictions.messagingRestrictedUntil'] = r.messagingRestricted
                    ? laterOf(r.messagingRestrictedUntil || null, s.messaging.until || null)
                    : (s.messaging.until || null);
                // «all» أشدّ من «new_only»
                const lvl = [r.messagingRestricted ? r.messagingRestrictedLevel : null, s.messaging.level];
                set['restrictions.messagingRestrictedLevel'] = lvl.includes('all') ? 'all' : (s.messaging.level || r.messagingRestrictedLevel || null);
                set['restrictions.restrictionReason'] = s.messaging.reason || 'تقييد سابق على حساب محذوف';
            }
            if (s.hidden && (s.hidden.permanent || (s.hidden.until && new Date(s.hidden.until) > now))) {
                set['hidden.isHidden'] = true;
                set['hidden.hiddenAt'] = now;
                set['hidden.hiddenUntil'] = s.hidden.permanent ? null : s.hidden.until;
                set['hidden.reason'] = s.hidden.reason || 'تقييد سابق على حساب محذوف';
            }
            if (s.suspension && (!s.suspension.until || new Date(s.suspension.until) > now)) {
                set['suspension.isSuspended'] = true;
                set['suspension.suspendedAt'] = now;
                set['suspension.suspendedUntil'] = s.suspension.until || null;
                set['suspension.reason'] = s.suspension.reason || 'تعليق سابق على حساب محذوف';
                set['suspension.level'] = Math.max(s.suspension.level || 0, (u.suspension && u.suspension.level) || 0);
            }
            if (s.storyBan && new Date(s.storyBan.until) > now) {
                set['storyBan.until'] = laterOf(u.storyBan && u.storyBan.until, s.storyBan.until);
                set['storyBan.reason'] = s.storyBan.reason || 'منع سابق على حساب محذوف';
                set['storyBan.at'] = now;
            }
            if (s.bannedWordsBan) {
                set['bannedWords.isBanned'] = true;
                set['bannedWords.bannedAt'] = now;
                set['bannedWords.banReason'] = s.bannedWordsBan.reason || 'حظر سابق على حساب محذوف';
            }
            if (s.warningsLevel) {
                set['warnings.level'] = Math.max(s.warningsLevel, (u.warnings && u.warnings.level) || 0);
                set['warnings.lastWarningAt'] = now;
            }
            if (s.externalPromo) {
                const ep = u.externalPromo || {};
                set['externalPromo.violations'] = Math.max(s.externalPromo.violations || 0, ep.violations || 0);
                set['externalPromo.lastViolationAt'] = s.externalPromo.lastViolationAt || ep.lastViolationAt || null;
                set['externalPromo.lockCount'] = Math.max(s.externalPromo.lockCount || 0, ep.lockCount || 0);
                set['externalPromo.lastLockAt'] = s.externalPromo.lastLockAt || ep.lastLockAt || null;
            }
        }

        // رفعه في «الحسابات الجديدة» للمراجعة — المشرف يقرّر بعدها
        const summary = [...new Set(records.flatMap(x => x.summary || []))];
        const deletedAt = records[0].deletedAt;
        set['newcomer.status'] = 'flagged';
        set['newcomer.flaggedAt'] = now;
        set['newcomer.flaggedReason'] = `🔁 أعاد التسجيل بعد حذف حساب مقيَّد (${fmt(deletedAt)}): ${summary.join('، ')}`.slice(0, 500);

        // updateOne يمرّ على hooks حالة الحساب (accountStateBroadcast) — مقصود عند التعليق
        await User.updateOne({ _id: u._id }, { $set: set });
        await RestrictionCarryover.updateMany(
            { _id: { $in: records.map(x => x._id) } },
            { $addToSet: { appliedTo: u._id } }
        );
        console.log(`[carryover] applied ${records.length} record(s) to ${u._id}`);
        return true;
    } catch (err) {
        console.error('[carryover] apply failed:', err.message);
        return false;
    }
}

module.exports = { captureOnDelete, applyToUser, pendingCarryoverSummary, buildSnapshot, identityHashes };

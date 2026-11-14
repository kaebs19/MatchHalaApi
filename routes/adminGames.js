// MatchHala - إدارة ألعاب المحادثة من لوحة التحكم (أدمن فقط)
//   GET    /api/admin/games/questions   قائمة + عدّاد لكل بنك
//   POST   /api/admin/games/questions   إضافة سؤال
//   POST   /api/admin/games/questions/bulk  إضافة عدّة أسئلة نصية (سطر لكل سؤال: عربي | English)
//   PUT    /api/admin/games/questions/:id   تعديل / تفعيل / تعطيل
//   DELETE /api/admin/games/questions/:id   حذف
//   GET/PUT /api/admin/games/config     الألعاب المتاحة للمستخدمين
//   GET    /api/admin/games/stats       إحصائيات الاستخدام
//   GET/PUT /api/admin/games/tab        ظهور تبويب الألعاب (هلا لودو) في التطبيق: off | admins | all

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const GameQuestion = require('../models/GameQuestion');
const GameConfig = require('../models/GameConfig');
const UserGameQuestion = require('../models/UserGameQuestion');
const Message = require('../models/Message');
const { invalidateBanks, ensureSeeded } = require('../utils/gameBanks');

router.use(protect, adminOnly);

const BANKS = ['truth', 'dare', 'wyr', 'never'];
const MAX_LEN = 200;

const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

const LEVELS = ['light', 'bold'];

// يبني وثيقة سؤال صالحة أو يرجع { error }
function buildQuestion(bank, body) {
    if (!BANKS.includes(bank)) return { error: 'بنك غير صالح' };
    const level = body.level === undefined ? undefined : body.level;
    if (level !== undefined && !LEVELS.includes(level)) return { error: 'مستوى غير صالح' };
    const withLevel = (doc) => (level ? { ...doc, level } : doc);
    if (bank === 'wyr') {
        const a = { ar: clean(body.a?.ar), en: clean(body.a?.en) };
        const b = { ar: clean(body.b?.ar), en: clean(body.b?.en) };
        if (!a.ar || !b.ar) return { error: 'الخياران العربيان مطلوبان' };
        if ([a.ar, a.en, b.ar, b.en].some(t => t.length > MAX_LEN)) return { error: `الحد الأقصى ${MAX_LEN} حرفاً` };
        return { doc: withLevel({ bank, a, b }) };
    }
    const ar = clean(body.ar);
    const en = clean(body.en);
    if (!ar) return { error: 'النص العربي مطلوب' };
    if (ar.length > MAX_LEN || en.length > MAX_LEN) return { error: `الحد الأقصى ${MAX_LEN} حرفاً` };
    return { doc: withLevel({ bank, ar, en }) };
}

router.get('/questions', async (req, res) => {
    try {
        // الصفحة قد تُفتح قبل أول لعبة — تأكّد من زرع الأسئلة الابتدائية
        await ensureSeeded().catch(err => console.error('🎮 seed:', err.message));
        const { bank, search, active, level } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));

        const query = {};
        if (bank && BANKS.includes(bank)) query.bank = bank;
        if (level === 'bold') query.level = 'bold';
        if (level === 'light') query.level = { $ne: 'bold' };
        if (active === 'true') query.active = true;
        if (active === 'false') query.active = false;
        if (search && typeof search === 'string') {
            const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [{ ar: rx }, { en: rx }, { 'a.ar': rx }, { 'b.ar': rx }, { 'a.en': rx }, { 'b.en': rx }];
        }

        const [items, total, counts] = await Promise.all([
            GameQuestion.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
            GameQuestion.countDocuments(query),
            GameQuestion.aggregate([{ $group: { _id: { bank: '$bank', active: '$active' }, n: { $sum: 1 } } }])
        ]);

        const byBank = Object.fromEntries(BANKS.map(b => [b, { total: 0, active: 0 }]));
        for (const c of counts) {
            byBank[c._id.bank].total += c.n;
            if (c._id.active) byBank[c._id.bank].active += c.n;
        }

        res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit), byBank } });
    } catch (error) {
        console.error('❌ admin games list:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.post('/questions', async (req, res) => {
    try {
        const { doc, error } = buildQuestion(req.body.bank, req.body);
        if (error) return res.status(400).json({ success: false, message: error });
        const created = await GameQuestion.create({ ...doc, active: req.body.active !== false });
        invalidateBanks();
        res.status(201).json({ success: true, data: created });
    } catch (error) {
        console.error('❌ admin games create:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// سطر لكل سؤال: «النص العربي | English» — للبنوك النصية فقط (لا wyr)
router.post('/questions/bulk', async (req, res) => {
    try {
        const { bank, text } = req.body;
        const level = req.body.level === 'bold' ? 'bold' : 'light';
        if (!['truth', 'dare', 'never'].includes(bank)) {
            return res.status(400).json({ success: false, message: 'الإضافة الجماعية للبنوك النصية فقط' });
        }
        if (typeof text !== 'string' || !text.trim()) {
            return res.status(400).json({ success: false, message: 'النص مطلوب' });
        }
        const docs = [];
        let skipped = 0;
        for (const line of text.split('\n').slice(0, 200)) {
            if (!line.trim()) continue;
            const [ar, en = ''] = line.split('|');
            const { doc } = buildQuestion(bank, { ar, en, level });
            if (doc) docs.push({ ...doc, active: true }); else skipped += 1;
        }
        if (docs.length) await GameQuestion.insertMany(docs);
        invalidateBanks();
        res.status(201).json({ success: true, data: { added: docs.length, skipped } });
    } catch (error) {
        console.error('❌ admin games bulk:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.put('/questions/:id', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const existing = await GameQuestion.findById(req.params.id);
        if (!existing) return res.status(404).json({ success: false, message: 'السؤال غير موجود' });

        const update = {};
        if (typeof req.body.active === 'boolean') update.active = req.body.active;
        if (req.body.level !== undefined) {
            if (!LEVELS.includes(req.body.level)) return res.status(400).json({ success: false, message: 'مستوى غير صالح' });
            update.level = req.body.level;
        }
        const hasContent = ['ar', 'en', 'a', 'b'].some(k => req.body[k] !== undefined);
        if (hasContent) {
            const { doc, error } = buildQuestion(existing.bank, req.body);
            if (error) return res.status(400).json({ success: false, message: error });
            delete doc.level;   // المستوى يُغيَّر بالحقل الصريح فقط
            Object.assign(update, doc);
            delete update.bank;
        }
        Object.assign(existing, update);
        await existing.save();
        invalidateBanks();
        res.json({ success: true, data: existing });
    } catch (error) {
        console.error('❌ admin games update:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.delete('/questions/:id', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const removed = await GameQuestion.findByIdAndDelete(req.params.id);
        if (!removed) return res.status(404).json({ success: false, message: 'السؤال غير موجود' });
        invalidateBanks();
        res.json({ success: true });
    } catch (error) {
        console.error('❌ admin games delete:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ─────────────────────────────────────────────────────────────
// أسئلة المستخدمين: اقتراحات للنشر العام + المُبلَّغ عنها
// ─────────────────────────────────────────────────────────────
router.get('/user-questions', async (req, res) => {
    try {
        const status = ['pending_review', 'reported', 'approved', 'rejected', 'active'].includes(req.query.status)
            ? req.query.status : null;
        const query = status ? { status } : { status: { $in: ['pending_review', 'reported'] } };
        const [items, counts] = await Promise.all([
            UserGameQuestion.find(query).sort({ updatedAt: -1 }).limit(100)
                .populate('owner', 'name email profileImage').lean(),
            UserGameQuestion.aggregate([
                { $match: { status: { $in: ['pending_review', 'reported'] } } },
                { $group: { _id: '$status', n: { $sum: 1 } } }
            ])
        ]);
        const pending = { pending_review: 0, reported: 0 };
        for (const c of counts) pending[c._id] = c.n;
        res.json({ success: true, data: { items, pending } });
    } catch (error) {
        console.error('❌ admin user-questions:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// approve: يُنسخ للبنك العام (خفيف) · reject: يُرفض · restore: يعود نشطاً لصاحبه · disable: يُعطَّل · (delete)
router.put('/user-questions/:id', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const q = await UserGameQuestion.findById(req.params.id);
        if (!q) return res.status(404).json({ success: false, message: 'السؤال غير موجود' });

        switch (req.body.action) {
            case 'approve': {
                if (q.status !== 'pending_review') {
                    return res.status(409).json({ success: false, message: 'ليس اقتراحاً معلّقاً' });
                }
                const pub = q.bank === 'wyr'
                    ? { bank: 'wyr', a: q.a, b: q.b }
                    : { bank: q.bank, ar: q.ar, en: q.en };
                await GameQuestion.create({ ...pub, level: 'light', active: true, fromUser: q.owner });
                q.status = 'approved';
                invalidateBanks();
                break;
            }
            case 'reject':
                q.status = 'rejected';
                q.active = false;
                break;
            case 'restore':
                q.status = 'active';
                q.active = true;
                q.reports = [];
                q.reportedAt = null;   // قرار الأدمن أن البلاغ غير صحيح → لا يُحتسب مخالفة
                break;
            case 'disable':
                q.status = 'rejected';
                q.active = false;
                break;
            default:
                return res.status(400).json({ success: false, message: 'إجراء غير معروف' });
        }
        await q.save();
        res.json({ success: true, data: q });
    } catch (error) {
        console.error('❌ admin user-questions action:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.get('/config', async (req, res) => {
    try {
        const config = await GameConfig.getConfig();
        res.json({ success: true, data: { enabledKinds: config.enabledKinds, allKinds: GameConfig.ALL_KINDS } });
    } catch (error) {
        console.error('❌ admin games config:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.put('/config', async (req, res) => {
    try {
        const { enabledKinds } = req.body;
        if (!Array.isArray(enabledKinds) || enabledKinds.some(k => !GameConfig.ALL_KINDS.includes(k))) {
            return res.status(400).json({ success: false, message: 'قائمة ألعاب غير صالحة' });
        }
        const config = await GameConfig.getConfig();
        config.enabledKinds = [...new Set(enabledKinds)];
        await config.save();
        res.json({ success: true, data: { enabledKinds: config.enabledKinds } });
    } catch (error) {
        console.error('❌ admin games config update:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ─────────── 🎲 تبويب الألعاب (Settings.gamesTab) + أرقام هلا لودو ───────────
const GAMES_TAB_MODES = ['off', 'admins', 'all'];
// كل حالات دعوة لودو — الاستعلام بها يستعمل الفهرس الجزئي game.status_1_game.updatedAt_1 (رسائل اللعب وحدها)
const LUDO_INVITE_STATUSES = ['pending', 'playing', 'finished', 'declined', 'cancelled', 'expired'];

async function ludoNumbers() {
    const LudoMatch = require('../models/LudoMatch');
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [total, last7, bySource, invites] = await Promise.all([
        LudoMatch.estimatedDocumentCount(),
        LudoMatch.countDocuments({ endedAt: { $gte: since } }),
        LudoMatch.aggregate([{ $match: { endedAt: { $gte: since } } }, { $group: { _id: '$source', n: { $sum: 1 } } }]),
        Message.aggregate([
            { $match: { type: 'game', 'game.status': { $in: LUDO_INVITE_STATUSES }, 'game.updatedAt': { $gte: since.toISOString() } } },
            { $match: { 'game.kind': 'ludo' } },
            { $group: { _id: '$game.status', n: { $sum: 1 } } }
        ])
    ]);
    return {
        total,
        last7,
        bySource: Object.fromEntries(bySource.map(r => [r._id || 'other', r.n])),
        invites: Object.fromEntries(invites.map(r => [r._id, r.n]))
    };
}

// ─────────── 🎲 هلا لودو: الإعدادات والجوائز (utils/ludo/config.js) ───────────

router.get('/ludo/config', async (req, res) => {
    try {
        const ludoConfig = require('../utils/ludo/config');
        const loaded = await ludoConfig.load();
        res.json({ success: true, data: { ...loaded, defaults: ludoConfig.defaults(), refreshMs: ludoConfig.constants.REFRESH_MS } });
    } catch (error) {
        console.error('❌ admin ludo config:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.put('/ludo/config', async (req, res) => {
    try {
        const ludoConfig = require('../utils/ludo/config');
        const saved = await ludoConfig.save(req.body?.config, req.user._id);
        console.log(`🎲 إعدادات هلا لودو حُدّثت (admin ${req.user._id})`);
        res.json({ success: true, data: saved });
    } catch (error) {
        if (error instanceof require('../utils/ludo/config').ConfigError) {
            return res.status(400).json({ success: false, message: error.message, errors: error.errors });
        }
        console.error('❌ admin ludo config update:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// 📈 أرقام هلا لودو (آخر N يوماً، الافتراضي 14): مباريات يومياً، فوز البشر ضدّ البوت، اللاعبون، هدية الإطلاق،
//    المشتريات والاستردادات، وبلاغات الدردشة. كلها من مجموعات صغيرة (LudoMatch/LudoWallet/LudoPurchase/Report) —
//    ⚠️ لا عدّ لدعوات المحادثة: تعني مسح مجموعة الرسائل (16 مليون).
router.get('/ludo/metrics', async (req, res) => {
    try {
        const LudoMatch = require('../models/LudoMatch');
        const LudoWallet = require('../models/LudoWallet');
        const LudoPurchase = require('../models/LudoPurchase');
        const Report = require('../models/Report');
        const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
        const since = new Date(Date.now() - days * 86400000);
        const TZ = 'Asia/Riyadh';

        const [perDay, botRows, players, giftClaimed, giftBlocked, purchases, reports] = await Promise.all([
            LudoMatch.aggregate([
                { $match: { endedAt: { $gte: since } } },
                { $group: {
                    _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$endedAt', timezone: TZ } }, league: { $ifNull: ['$league', 'friendly'] } },
                    n: { $sum: 1 }
                } },
                { $sort: { '_id.day': 1 } }
            ]),
            // مباريات فيها بوت وإنسان: هل فاز إنسان؟ (winners = بشر فقط)
            LudoMatch.aggregate([
                { $match: { endedAt: { $gte: since }, 'players.isBot': true } },
                { $match: { players: { $elemMatch: { isBot: false } } } },
                { $group: {
                    _id: { $cond: [{ $ifNull: ['$league', false] }, 'league', 'friendly'] },
                    total: { $sum: 1 },
                    humanWins: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$winners', []] } }, 0] }, 1, 0] } }
                } }
            ]),
            LudoMatch.distinct('players.user', { endedAt: { $gte: since } }),
            LudoWallet.countDocuments({ launchGiftAt: { $ne: null }, launchGiftBlocked: { $ne: true } }),
            LudoWallet.countDocuments({ launchGiftBlocked: true }),
            LudoPurchase.aggregate([
                { $match: { createdAt: { $gte: since } } },
                { $group: { _id: '$productId', n: { $sum: 1 }, refunded: { $sum: { $cond: [{ $ifNull: ['$refundedAt', false] }, 1, 0] } } } },
                { $sort: { n: -1 } }
            ]),
            Report.countDocuments({ createdAt: { $gte: since }, description: /^🎲 بلاغ من دردشة/ })
        ]);

        const daysMap = {};
        for (const r of perDay) {
            const d = (daysMap[r._id.day] ||= { day: r._id.day, total: 0, bronze: 0, silver: 0, gold: 0, friendly: 0 });
            d[r._id.league] = r.n;
            d.total += r.n;
        }
        const bot = Object.fromEntries(botRows.map(r => [r._id, {
            total: r.total, humanWins: r.humanWins, humanWinRate: r.total ? Math.round((r.humanWins / r.total) * 100) : null
        }]));
        res.json({
            success: true,
            data: {
                days,
                perDay: Object.values(daysMap),
                totals: {
                    matches: perDay.reduce((a, r) => a + r.n, 0),
                    players: players.filter(Boolean).length,
                    giftClaimed, giftBlocked,
                    purchases: purchases.reduce((a, p) => a + p.n, 0),
                    refunds: purchases.reduce((a, p) => a + p.refunded, 0),
                    chatReports: reports
                },
                botWinRate: bot,
                purchases: purchases.map(p => ({ productId: p._id, n: p.n, refunded: p.refunded }))
            }
        });
    } catch (error) {
        console.error('❌ admin ludo metrics:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// ترتيب الأسبوع الحالي (أو weekKey) وما سيأخذه أعلى 10 — للمراجعة قبل التوزيع
router.get('/ludo/standings', async (req, res) => {
    try {
        const economy = require('../utils/ludo/economy');
        const weekKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.week || '')) ? String(req.query.week) : undefined;
        res.json({ success: true, data: await economy.weekStandings(10, Date.now(), weekKey) });
    } catch (error) {
        console.error('❌ admin ludo standings:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// أرشيف الأسابيع الموزّعة: من فاز وماذا أخذ
router.get('/ludo/seasons', async (req, res) => {
    try {
        const LudoSeason = require('../models/LudoSeason');
        const seasons = await LudoSeason.find().sort({ weekKey: -1 }).limit(12)
            .populate('winners.user', 'name profileImage').lean();
        res.json({
            success: true,
            data: seasons.map(s => ({
                weekKey: s.weekKey,
                awardedAt: s.awardedAt,
                winners: (s.winners || []).map(w => ({
                    rank: w.rank, points: w.points, coins: w.coins || 0, gems: w.gems || 0,
                    id: w.user?._id ? String(w.user._id) : null, name: w.user?.name || '—', photo: w.user?.profileImage || null
                }))
            }))
        });
    } catch (error) {
        console.error('❌ admin ludo seasons:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.get('/tab', async (req, res) => {
    try {
        const Settings = require('../models/Settings');
        const doc = await Settings.findOne().select('gamesTab').lean();
        res.json({ success: true, data: { gamesTab: doc?.gamesTab || 'admins', modes: GAMES_TAB_MODES, ludo: await ludoNumbers() } });
    } catch (error) {
        console.error('❌ admin games tab:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.put('/tab', async (req, res) => {
    try {
        const { gamesTab } = req.body;
        if (!GAMES_TAB_MODES.includes(gamesTab)) {
            return res.status(400).json({ success: false, message: 'قيمة غير صالحة' });
        }
        const Settings = require('../models/Settings');
        // وثيقة الإعدادات واحدة — updateOne بلا upsert: لا ننشئ وثيقة ثانية بالافتراضيات
        const r = await Settings.updateOne({}, { $set: { gamesTab } });
        if (!r.matchedCount) return res.status(404).json({ success: false, message: 'وثيقة الإعدادات غير موجودة' });
        require('../utils/featureFlags').invalidateFeatureFlags();
        console.log(`🎮 gamesTab ← ${gamesTab} (admin ${req.user._id})`);
        res.json({ success: true, data: { gamesTab } });
    } catch (error) {
        console.error('❌ admin games tab update:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const rows = await Message.aggregate([
            { $match: { type: 'game' } },
            {
                $group: {
                    _id: { kind: '$game.kind', status: '$game.status' },
                    n: { $sum: 1 },
                    last7: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
                    rounds: { $sum: { $ifNull: ['$game.round', 0] } }
                }
            }
        ]);
        const kinds = {};
        for (const k of GameConfig.ALL_KINDS) kinds[k] = { total: 0, last7: 0, active: 0, invited: 0, ended: 0, declined: 0, rounds: 0 };
        for (const r of rows) {
            const k = kinds[r._id.kind];
            if (!k) continue;
            k.total += r.n;
            k.last7 += r.last7;
            k.rounds += r.rounds;
            if (k[r._id.status] !== undefined) k[r._id.status] += r.n;
        }
        res.json({ success: true, data: { kinds } });
    } catch (error) {
        console.error('❌ admin games stats:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;

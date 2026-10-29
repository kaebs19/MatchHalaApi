// Mobile Routes - قصص البروفايل
// صور فقط · 3 قصص نشطة كحدّ أقصى · كل قصة 24 ساعة · يراها كل من يفتح البروفايل.
// المشاهدات: العدد لصاحب القصة دائماً، والأسماء لمشترك هلا+ فقط (مثل «الزوار»).
// قواعد لا تُرخى: لا قصص بين طرفَي حظر، ولا قصص لمحظور/معطَّل، والتخفي أو المشرف لا يُسجّل مشاهدة ظاهرة.
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const mongoose = require('mongoose');
const User = require('../../models/User');
const Story = require('../../models/Story');
const StoryView = require('../../models/StoryView');
const { protect } = require('../../middleware/auth');
const { getFullUrl, getBlockState, isUserFullyBanned } = require('./helpers');
const { checkBannedWords } = require('../bannedWords');
const { detectExternalPromotion } = require('../../utils/externalPromotionDetector');
const { notifyStoryScreenshot, notifyFriendsOfStory } = require('../../utils/storyNotifications');

// القصص النشطة: 3 مجاناً، 10 لمشترك هلا+ (مثل حدّ الفيديو اليومي)
const STORY_MAX_ACTIVE = { free: 3, premium: 10 };
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_MAX_EDGE = 1920;
const STATUS_MAX_USERS = 200;
const STORY_TEXT_MAX = 250;
const STORY_BACKGROUNDS = 8;   // عدد خلفيات القصة النصّية في التطبيق (0…7)
// تفاعلات القصة المسموحة — قائمة ثابتة (لا نصّ حرّ يصل لصاحب القصة)
const STORY_REACTIONS = ['❤️', '😍', '😂', '😮', '😢', '🔥', '👏'];

// ⚠️ uploads/ephemeral لا uploads/stories: Nginx يقدّمه بـ private, no-store فلا يبقى في
//    Cloudflare بعد انتهاء القصة. مجلد جديد تحت /uploads/ كان سيُخزَّن 30 يوماً (immutable).
const STORY_DIR = path.join(__dirname, '..', '..', 'uploads', 'ephemeral');
if (!fs.existsSync(STORY_DIR)) fs.mkdirSync(STORY_DIR, { recursive: true });

const uploadStoryImage = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, STORY_DIR),
        filename: (req, file, cb) => cb(null, `story-up-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`)
    }),
    limits: { fileSize: 4 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|jpg|png|heic|heif|webp)$/.test(file.mimetype)) return cb(null, true);
        cb(new Error('فقط الصور مسموحة'));
    }
});

function receiveStoryImage(req, res, next) {
    uploadStoryImage.single('image')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, message: 'حجم الصورة كبير جداً', code: 'STORY_TOO_LARGE' });
        }
        return res.status(400).json({ success: false, message: err.message || 'ملف الصورة غير صالح', code: 'STORY_INVALID' });
    });
}

const isPremiumActive = (user) => !!(user?.isPremium && user.premiumExpiresAt && new Date(user.premiumExpiresAt) > new Date());
const maxStoriesFor = (user) => (isPremiumActive(user) ? STORY_MAX_ACTIVE.premium : STORY_MAX_ACTIVE.free);

// القصص النشطة فعلاً — الكنس كل 5 دقائق، فالوقت يُفحص هنا أيضاً
const activeFilter = (extra = {}) => ({ status: 'active', expiresAt: { $gt: new Date() }, ...extra });
// ما يراه غير صاحبها: النشطة غير المحجوبة (heldAt: null يطابق الحقل الغائب أيضاً)
const visibleFilter = (extra = {}) => activeFilter({ heldAt: null, ...extra });

const serialize = (story, { owner = false, viewed = false, myReaction = null } = {}) => ({
    _id: story._id,
    kind: story.kind || 'image',
    text: story.kind === 'text' ? story.text : undefined,
    background: story.kind === 'text' ? (story.background || 0) : undefined,
    imageUrl: getFullUrl(story.imageUrl),
    width: story.width,
    height: story.height,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    ...(owner
        ? { viewCount: story.viewCount || 0, screenshotCount: story.screenshotCount || 0, reactionCount: story.reactionCount || 0, held: !!story.heldAt }
        : { viewed, myReaction })
});

const unlinkQuiet = (p) => { if (p) { try { fs.unlinkSync(p); } catch (e) { /* ignore */ } } };

// @route   POST /api/mobile/stories
// @desc    نشر قصة (multipart: image)
// @access  Private
router.post('/stories', protect, receiveStoryImage, async (req, res) => {
    const uploaded = req.file?.path;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'لم يتم رفع صورة', code: 'STORY_INVALID' });
        }
        const gate = await publishGate(req);
        if (gate) {
            unlinkQuiet(uploaded);
            return res.status(gate.status).json(gate.body);
        }
        const activeCount = await Story.countDocuments(activeFilter({ user: req.user._id }));

        // إعادة ترميز: تطبيق اتجاه EXIF، تصغير، وإسقاط كل البيانات الوصفية (الموقع GPS)
        const sharp = require('sharp');
        const fileName = `story-${Date.now()}-${crypto.randomBytes(12).toString('hex')}.jpg`;
        const outPath = path.join(STORY_DIR, fileName);
        let info;
        try {
            info = await sharp(uploaded)
                .rotate()
                .resize({ width: STORY_MAX_EDGE, height: STORY_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 82, mozjpeg: true })
                .toFile(outPath);
        } catch (e) {
            unlinkQuiet(uploaded);
            unlinkQuiet(outPath);
            return res.status(400).json({ success: false, message: 'ملف الصورة غير صالح', code: 'STORY_INVALID' });
        }
        unlinkQuiet(uploaded);

        const story = await Story.create({
            user: req.user._id,
            imageUrl: `/uploads/ephemeral/${fileName}`,
            width: info.width,
            height: info.height,
            expiresAt: new Date(Date.now() + STORY_TTL_MS)
        });
        notifyFriendsOfStory(story, req.user).catch(e => console.error('friend-story notify:', e.message));

        res.status(201).json({
            success: true,
            data: { story: serialize(story, { owner: true }), active: activeCount + 1, max: maxStoriesFor(req.user), freeMax: STORY_MAX_ACTIVE.free, premiumMax: STORY_MAX_ACTIVE.premium }
        });
    } catch (error) {
        unlinkQuiet(uploaded);
        console.error('خطأ في نشر القصة:', error);
        res.status(500).json({ success: false, message: 'فشل نشر القصة' });
    }
});

// قبل أي نشر: ممنوع/محظور + الحدّ. يُرجع ردّ الرفض أو null
async function publishGate(req) {
    if (isUserFullyBanned(req.user) || req.user.suspension?.isSuspended) {
        return { status: 403, body: { success: false, message: 'لا يمكنك نشر قصص حالياً', code: 'STORY_FORBIDDEN' } };
    }
    // منع من المشرف لفترة (لوحة التحكم ← قصص المستخدم)
    const banUntil = req.user.storyBan?.until ? new Date(req.user.storyBan.until) : null;
    if (banUntil && banUntil > new Date()) {
        const day = banUntil.toLocaleDateString('ar-SA', { day: 'numeric', month: 'long' });
        return {
            status: 403,
            body: {
                success: false,
                message: `أنت ممنوع من نشر القصص حتى ${day} لمخالفة سياسة المحتوى`,
                code: 'STORY_BANNED',
                data: { until: banUntil, reason: req.user.storyBan.reason || null }
            }
        };
    }
    const activeCount = await Story.countDocuments(activeFilter({ user: req.user._id }));
    const max = maxStoriesFor(req.user);
    if (activeCount >= max) {
        const premium = isPremiumActive(req.user);
        return {
            status: 429,
            body: {
                success: false,
                message: premium
                    ? `لديك ${max} قصص نشطة — احذف واحدة أو انتظر انتهاءها`
                    : `مسموح ${max} قصص نشطة — اشترك في هلا+ لإضافة حتى ${STORY_MAX_ACTIVE.premium}`,
                code: 'STORY_LIMIT',
                data: { max, active: activeCount, freeMax: STORY_MAX_ACTIVE.free, premiumMax: STORY_MAX_ACTIVE.premium, isPremium: premium }
            }
        };
    }
    return null;
}

// @route   POST /api/mobile/stories/text
// @desc    قصة نصّية { text ≤250, background 0…7 } — فلتر الترويج الخارجي والكلمات المحظورة (422)
// @access  Private
router.post('/stories/text', protect, async (req, res) => {
    try {
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text) {
            return res.status(400).json({ success: false, message: 'اكتب نصّ القصة', code: 'STORY_INVALID' });
        }
        if (text.length > STORY_TEXT_MAX) {
            return res.status(400).json({ success: false, message: `النصّ حتى ${STORY_TEXT_MAX} حرفاً`, code: 'STORY_INVALID' });
        }
        const gate = await publishGate(req);
        if (gate) return res.status(gate.status).json(gate.body);

        // ⚠️ النصّ الحرّ الوحيد في القصص — يفلت منه الترويج لحسابات خارجية إن لم يُفحص
        if (detectExternalPromotion(text).detected || (await checkBannedWords(text)).hasBannedWords) {
            return res.status(422).json({
                success: false,
                message: 'النص يحتوي محتوى غير مسموح (حسابات خارجية أو كلمات محظورة) — عدّله وأعد المحاولة',
                code: 'STORY_TEXT_BLOCKED'
            });
        }

        const bg = Number.isInteger(req.body?.background) && req.body.background >= 0 && req.body.background < STORY_BACKGROUNDS
            ? req.body.background : 0;
        const story = await Story.create({
            user: req.user._id,
            kind: 'text',
            text,
            background: bg,
            expiresAt: new Date(Date.now() + STORY_TTL_MS)
        });
        notifyFriendsOfStory(story, req.user).catch(e => console.error('friend-story notify:', e.message));
        const active = await Story.countDocuments(activeFilter({ user: req.user._id }));
        res.status(201).json({ success: true, data: { story: serialize(story, { owner: true }), active, max: maxStoriesFor(req.user), freeMax: STORY_MAX_ACTIVE.free, premiumMax: STORY_MAX_ACTIVE.premium } });
    } catch (error) {
        console.error('خطأ في نشر قصة نصّية:', error);
        res.status(500).json({ success: false, message: 'فشل نشر القصة' });
    }
});

// @route   GET /api/mobile/stories/me
// @desc    قصصي النشطة مع عدد المشاهدات
// @access  Private
router.get('/stories/me', protect, async (req, res) => {
    try {
        const stories = await Story.find(activeFilter({ user: req.user._id })).sort({ createdAt: 1 }).lean();
        res.json({
            success: true,
            data: { stories: stories.map(s => serialize(s, { owner: true })), max: maxStoriesFor(req.user), freeMax: STORY_MAX_ACTIVE.free, premiumMax: STORY_MAX_ACTIVE.premium }
        });
    } catch (error) {
        console.error('خطأ في جلب قصصي:', error);
        res.status(500).json({ success: false, message: 'فشل جلب القصص' });
    }
});

// @route   GET /api/mobile/users/:userId/stories
// @desc    قصص مستخدم (مع «شاهدتُها؟» لكل قصة)
// @access  Private
router.get('/users/:userId/stories', protect, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.isValidObjectId(userId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const isOwner = String(userId) === String(req.user._id);

        if (!isOwner) {
            const owner = await User.findById(userId).select('isActive bannedWords suspension').lean();
            if (!owner || isUserFullyBanned(owner)) {
                return res.json({ success: true, data: { stories: [] } });
            }
            const block = await getBlockState(req.user._id, userId);
            if (block.blocked) {
                return res.json({ success: true, data: { stories: [] } });
            }
        }

        // صاحبها يرى المحجوبة (مع held)، وغيره لا
        const stories = await Story.find((isOwner ? activeFilter : visibleFilter)({ user: userId })).sort({ createdAt: 1 }).lean();
        let viewedSet = new Set();
        const reactionMap = new Map();
        if (!isOwner && stories.length) {
            const seen = await StoryView.find({ viewer: req.user._id, story: { $in: stories.map(s => s._id) } })
                .select('story reaction').lean();
            viewedSet = new Set(seen.map(v => String(v.story)));
            seen.forEach(v => { if (v.reaction) reactionMap.set(String(v.story), v.reaction); });
        }

        const muted = !isOwner && (req.user.storyMutedUsers || []).some(id => String(id) === String(userId));
        res.json({
            success: true,
            data: {
                stories: stories.map(s => serialize(s, {
                    owner: isOwner,
                    viewed: viewedSet.has(String(s._id)),
                    myReaction: reactionMap.get(String(s._id)) || null
                })),
                muted
            }
        });
    } catch (error) {
        console.error('خطأ في جلب قصص المستخدم:', error);
        res.status(500).json({ success: false, message: 'فشل جلب القصص' });
    }
});

// @route   GET /api/mobile/stories/feed?limit=30
// @desc    «القصص» من الاكتشاف: أصحاب القصص مرتّبين — غير المُشاهَد أولاً، ثم بنقاط:
//          التفاعل (تفاعلات ×4 + مشاهدات، لوغاريتمي) + المشترك/الموثّق + الحداثة + عشوائية مقصودة
//          (لا يتكرّر الترتيب نفسه)، مع خفض قوي للمُبلَّغ عنها والحسابات المخفية (خفض لا استبعاد).
//          يُستبعد: أنا، الحظر بأي اتجاه، المكتومون، المحظورون كلياً وغير النشطين. المحجوبة بالبلاغات
//          لا تظهر أصلاً (visibleFilter). العميل يجلب قصص كل صاحب حين يحين دوره في العارض.
// @access  Private
const FEED_MAX = 50;
const FEED_CANDIDATES = 400;
router.get('/stories/feed', protect, async (req, res) => {
    try {
        const limit = Math.min(FEED_MAX, Math.max(1, parseInt(req.query.limit, 10) || 30));
        const me = String(req.user._id);

        const groups = await Story.aggregate([
            { $match: visibleFilter() },
            { $group: {
                _id: '$user',
                storyIds: { $push: '$_id' },
                latest: { $max: '$createdAt' },
                views: { $sum: '$viewCount' },
                reactions: { $sum: '$reactionCount' },
                reports: { $sum: '$reportCount' }
            } },
            { $sort: { latest: -1 } },
            { $limit: FEED_CANDIDATES }
        ]);
        if (!groups.length) return res.json({ success: true, data: { owners: [] } });

        const myBlocked = new Set((req.user.blockedUsers || []).map(String));
        const myMuted = new Set((req.user.storyMutedUsers || []).map(String));
        const owners = await User.find({ _id: { $in: groups.map(g => g._id) } })
            .select('name profileImage photos isActive bannedWords suspension blockedUsers isPremium premiumExpiresAt verification.isVerified hidden')
            .lean();
        const ownerById = new Map(owners.map(u => [String(u._id), u]));

        const now = Date.now();
        const visible = groups.filter(g => {
            const id = String(g._id);
            const u = ownerById.get(id);
            return u && id !== me
                && u.isActive !== false
                && !isUserFullyBanned(u)
                && !myBlocked.has(id) && !myMuted.has(id)
                && !(u.blockedUsers || []).some(b => String(b) === me);
        });

        const allStoryIds = visible.flatMap(g => g.storyIds);
        const seen = allStoryIds.length
            ? await StoryView.find({ viewer: req.user._id, story: { $in: allStoryIds } }).select('story').lean()
            : [];
        const seenSet = new Set(seen.map(v => String(v.story)));

        const ranked = visible.map(g => {
            const u = ownerById.get(String(g._id));
            const ageHours = (now - new Date(g.latest).getTime()) / 3600000;
            const hidden = !!(u.hidden?.isHidden && (!u.hidden.hiddenUntil || new Date(u.hidden.hiddenUntil) > new Date()));
            const score =
                2.0 * Math.log1p((g.reactions || 0) * 4 + (g.views || 0))
                + (isPremiumActive(u) ? 1.5 : 0)
                + (u.verification?.isVerified ? 0.5 : 0)
                + 1.5 * Math.exp(-ageHours / 8)
                + Math.random() * 1.5
                - 2.5 * Math.min(3, g.reports || 0)
                - (hidden ? 4 : 0);
            return {
                u,
                count: g.storyIds.length,
                hasUnseen: g.storyIds.some(id => !seenSet.has(String(id))),
                score
            };
        })
            .sort((a, b) => (b.hasUnseen - a.hasUnseen) || (b.score - a.score))
            .slice(0, limit);

        res.json({
            success: true,
            data: {
                owners: ranked.map(r => ({
                    _id: r.u._id,
                    name: r.u.name,
                    profileImage: getFullUrl(r.u.profileImage),
                    isPremium: isPremiumActive(r.u),
                    isVerified: !!r.u.verification?.isVerified,
                    count: r.count,
                    hasUnseen: r.hasUnseen
                }))
            }
        });
    } catch (error) {
        console.error('خطأ في خلاصة القصص:', error);
        res.status(500).json({ success: false, message: 'فشل جلب القصص' });
    }
});

// @route   POST /api/mobile/stories/status
// @desc    حالة القصص لعدة مستخدمين دفعة واحدة (شريط الأصدقاء، قائمة المحادثات، الاكتشاف)
//          body: { userIds: [...] } ← { statuses: { <userId>: { count, hasUnseen } } } — من لا قصة له لا يظهر
// @access  Private
router.post('/stories/status', protect, async (req, res) => {
    try {
        const raw = Array.isArray(req.body?.userIds) ? req.body.userIds : [];
        const me = String(req.user._id);
        const ids = [...new Set(raw.map(String))]
            .filter(id => mongoose.isValidObjectId(id) && id !== me)
            .slice(0, STATUS_MAX_USERS);
        if (!ids.length) return res.json({ success: true, data: { statuses: {} } });

        const objectIds = ids.map(id => new mongoose.Types.ObjectId(id));
        const grouped = await Story.aggregate([
            { $match: visibleFilter({ user: { $in: objectIds } }) },
            { $group: { _id: '$user', storyIds: { $push: '$_id' } } }
        ]);
        if (!grouped.length) return res.json({ success: true, data: { statuses: {} } });

        const ownerIds = grouped.map(g => g._id);
        const myBlocked = new Set((req.user.blockedUsers || []).map(String));
        const myMuted = new Set((req.user.storyMutedUsers || []).map(String));
        const owners = await User.find({ _id: { $in: ownerIds } })
            .select('isActive bannedWords suspension blockedUsers').lean();
        const allowed = new Set(owners
            .filter(u => !isUserFullyBanned(u))
            .filter(u => !myBlocked.has(String(u._id)))
            .filter(u => !myMuted.has(String(u._id)))
            .filter(u => !(u.blockedUsers || []).some(b => String(b) === me))
            .map(u => String(u._id)));

        const visible = grouped.filter(g => allowed.has(String(g._id)));
        const allStoryIds = visible.flatMap(g => g.storyIds);
        const seen = allStoryIds.length
            ? await StoryView.find({ viewer: req.user._id, story: { $in: allStoryIds } }).select('story').lean()
            : [];
        const seenSet = new Set(seen.map(v => String(v.story)));

        const statuses = {};
        for (const g of visible) {
            statuses[String(g._id)] = {
                count: g.storyIds.length,
                hasUnseen: g.storyIds.some(id => !seenSet.has(String(id)))
            };
        }
        res.json({ success: true, data: { statuses } });
    } catch (error) {
        console.error('خطأ في حالة القصص:', error);
        res.status(500).json({ success: false, message: 'فشل جلب حالة القصص' });
    }
});

// @route   POST /api/mobile/stories/:storyId/view
// @desc    تسجيل مشاهدة (مرة لكل مشاهد) — التخفي/المشرف مخفيّة ولا تُعدّ
// @access  Private
router.post('/stories/:storyId/view', protect, async (req, res) => {
    try {
        const { storyId } = req.params;
        if (!mongoose.isValidObjectId(storyId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const story = await Story.findOne(visibleFilter({ _id: storyId })).select('user kind imageUrl').lean();
        if (!story) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة أو انتهت', code: 'STORY_NOT_FOUND' });
        }
        const ownerId = String(story.user);
        if (ownerId === String(req.user._id)) {
            return res.json({ success: true, data: { recorded: false } });
        }
        const block = await getBlockState(req.user._id, ownerId);
        if (block.blocked) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة أو انتهت', code: 'STORY_NOT_FOUND' });
        }

        const isHidden = !!req.user.stealthMode || req.user.role === 'admin';
        const result = await StoryView.updateOne(
            { story: story._id, viewer: req.user._id },
            { $setOnInsert: { owner: story.user, isHidden, viewedAt: new Date() } },
            { upsert: true }
        );
        const isNew = result.upsertedCount > 0;

        if (isNew && !isHidden) {
            const updated = await Story.findOneAndUpdate(
                { _id: story._id },
                { $inc: { viewCount: 1 } },
                { returnDocument: 'after', projection: { viewCount: 1 } }
            ).lean();
            if (global.io && updated) {
                global.io.to(`user:${ownerId}`).emit('story:viewed', { storyId: String(story._id), viewCount: updated.viewCount });
            }
        }
        res.json({ success: true, data: { recorded: isNew && !isHidden } });
    } catch (error) {
        console.error('خطأ في تسجيل مشاهدة القصة:', error);
        res.status(500).json({ success: false, message: 'فشل تسجيل المشاهدة' });
    }
});

// @route   POST /api/mobile/stories/:storyId/screenshot
// @desc    المشاهد التقط لقطة شاشة لقصة — تُعدّ مرة لكل مشاهد، وصاحبها يُبلَّغ لحظياً (story:screenshot)
//          التخفي/المشرف لا يُعدّ (مثل المشاهدة). يتطلّب مشاهدة مسجّلة (التطبيق يسجّلها عند الفتح).
// @access  Private
router.post('/stories/:storyId/screenshot', protect, async (req, res) => {
    try {
        const { storyId } = req.params;
        if (!mongoose.isValidObjectId(storyId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const story = await Story.findOne(visibleFilter({ _id: storyId })).select('user kind imageUrl').lean();
        if (!story) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة أو انتهت', code: 'STORY_NOT_FOUND' });
        }
        const ownerId = String(story.user);
        if (ownerId === String(req.user._id)) {
            return res.json({ success: true, data: { recorded: false } });
        }
        const block = await getBlockState(req.user._id, ownerId);
        if (block.blocked) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة أو انتهت', code: 'STORY_NOT_FOUND' });
        }

        // screenshotAt: null في الشرط = مرة واحدة لكل مشاهد حتى مع طلبات متزامنة
        const result = await StoryView.updateOne(
            { story: story._id, viewer: req.user._id, screenshotAt: null },
            { $set: { screenshotAt: new Date() } }
        );
        const isHidden = !!req.user.stealthMode || req.user.role === 'admin';
        const recorded = result.modifiedCount > 0 && !isHidden;

        if (recorded) {
            const updated = await Story.findOneAndUpdate(
                { _id: story._id },
                { $inc: { screenshotCount: 1 } },
                { returnDocument: 'after', projection: { screenshotCount: 1 } }
            ).lean();
            if (global.io && updated) {
                global.io.to(`user:${ownerId}`).emit('story:screenshot', { storyId: String(story._id), screenshotCount: updated.screenshotCount });
            }
            notifyStoryScreenshot(story, req.user).catch(e => console.error('story-screenshot notify:', e.message));
        }
        res.json({ success: true, data: { recorded } });
    } catch (error) {
        console.error('خطأ في تسجيل لقطة شاشة القصة:', error);
        res.status(500).json({ success: false, message: 'فشل التسجيل' });
    }
});

// @route   POST /api/mobile/stories/:storyId/react
// @desc    تفاعل المشاهد مع قصة: { emoji } من STORY_REACTIONS، أو emoji فارغ/null لإزالته.
//          واحد لكل مشاهد (يُستبدل). يظهر بجانب اسمه في قائمة المشاهدين (لهلا+)، وصاحبها
//          يُبلَّغ لحظياً (story:reaction) وبإشعار عند أول تفاعل فقط (لا إشعار مع كل تبديل).
//          التخفي/المشرف: يُحفظ ولا يُعدّ ولا يُبلَّغ — مثل المشاهدة.
// @access  Private
router.post('/stories/:storyId/react', protect, async (req, res) => {
    try {
        const { storyId } = req.params;
        if (!mongoose.isValidObjectId(storyId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const raw = req.body?.emoji;
        const emoji = raw ? String(raw) : null;
        if (emoji && !STORY_REACTIONS.includes(emoji)) {
            return res.status(400).json({ success: false, message: 'تفاعل غير مدعوم', code: 'STORY_INVALID' });
        }
        const story = await Story.findOne(visibleFilter({ _id: storyId })).select('user kind imageUrl').lean();
        if (!story) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة أو انتهت', code: 'STORY_NOT_FOUND' });
        }
        const ownerId = String(story.user);
        if (ownerId === String(req.user._id)) {
            return res.status(400).json({ success: false, message: 'لا يمكنك التفاعل مع قصتك', code: 'STORY_INVALID' });
        }
        const block = await getBlockState(req.user._id, ownerId);
        if (block.blocked) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة أو انتهت', code: 'STORY_NOT_FOUND' });
        }

        const isHidden = !!req.user.stealthMode || req.user.role === 'admin';
        // المشاهدة شرط للتفاعل — نُنشئها إن سبق الطلبُ طلبَ المشاهدة (يُرسلان معاً من التطبيق)
        const upsert = await StoryView.updateOne(
            { story: story._id, viewer: req.user._id },
            { $setOnInsert: { owner: story.user, isHidden, viewedAt: new Date() } },
            { upsert: true }
        );
        if (upsert.upsertedCount > 0 && !isHidden) {
            const viewed = await Story.findOneAndUpdate(
                { _id: story._id }, { $inc: { viewCount: 1 } },
                { returnDocument: 'after', projection: { viewCount: 1 } }
            ).lean();
            if (global.io && viewed) {
                global.io.to(`user:${ownerId}`).emit('story:viewed', { storyId: String(story._id), viewCount: viewed.viewCount });
            }
        }

        const before = await StoryView.findOneAndUpdate(
            { story: story._id, viewer: req.user._id },
            { $set: { reaction: emoji, reactedAt: emoji ? new Date() : null } },
            { returnDocument: 'before', projection: { reaction: 1 } }
        ).lean();
        const hadReaction = !!before?.reaction;

        let reactionCount = null;
        if (!isHidden && hadReaction !== !!emoji) {
            const updated = await Story.findOneAndUpdate(
                { _id: story._id }, { $inc: { reactionCount: emoji ? 1 : -1 } },
                { returnDocument: 'after', projection: { reactionCount: 1 } }
            ).lean();
            reactionCount = Math.max(0, updated?.reactionCount || 0);
        }

        if (!isHidden && global.io) {
            global.io.to(`user:${ownerId}`).emit('story:reaction', {
                storyId: String(story._id),
                reactionCount,
                viewerId: String(req.user._id),
                emoji
            });
        }

        // إشعار عند أول تفاعل فقط
        if (!isHidden && emoji && !hadReaction) {
            try {
                const Notification = require('../../models/Notification');
                const pushService = require('../../services/pushNotificationService');
                const name = req.user.name || 'مستخدم';
                const verb = req.user.gender === 'female' ? 'تفاعلت' : 'تفاعل';
                const image = getFullUrl(req.user.profileImage) || '';
                const title = `${emoji} تفاعل مع قصتك`;
                const body = `${name} ${verb} مع قصتك ${emoji}`;
                await Notification.create({
                    title, body,
                    type: 'story_reaction',
                    sender: req.user._id,
                    recipients: 'specific',
                    targetUsers: [ownerId],
                    data: { storyId: String(story._id), senderId: String(req.user._id), senderName: name, senderAvatar: image, emoji },
                    status: 'sent',
                    sentAt: new Date()
                });
                pushService.sendNotificationToUser(ownerId, { title, body }, {
                    type: 'story_reaction',
                    storyId: String(story._id),
                    senderId: String(req.user._id),
                    senderName: name,
                    senderImage: image,
                    storyImage: story.kind === 'text' || !story.imageUrl ? '' : (getFullUrl(story.imageUrl) || '')
                }, false).catch(() => {});
            } catch (notifErr) {
                console.error('story-reaction notify error:', notifErr.message);
            }
        }

        res.json({ success: true, data: { reaction: emoji } });
    } catch (error) {
        console.error('خطأ في تفاعل القصة:', error);
        res.status(500).json({ success: false, message: 'فشل التفاعل' });
    }
});

// @route   POST /api/mobile/stories/mute/:userId    — إخفاء قصص مستخدم (كتم)
// @route   DELETE /api/mobile/stories/mute/:userId  — إظهارها
// @desc    لا حلقة له في القوائم/شريط الأصدقاء (/stories/status). قصصه تبقى من بروفايله ولا يُعلَم بالكتم.
// @access  Private
router.post('/stories/mute/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.isValidObjectId(userId) || String(userId) === String(req.user._id)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        await User.updateOne({ _id: req.user._id }, { $addToSet: { storyMutedUsers: userId } });
        res.json({ success: true, data: { muted: true } });
    } catch (error) {
        console.error('خطأ في إخفاء القصص:', error);
        res.status(500).json({ success: false, message: 'فشل إخفاء القصص' });
    }
});

router.delete('/stories/mute/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.isValidObjectId(userId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        await User.updateOne({ _id: req.user._id }, { $pull: { storyMutedUsers: userId } });
        res.json({ success: true, data: { muted: false } });
    } catch (error) {
        console.error('خطأ في إظهار القصص:', error);
        res.status(500).json({ success: false, message: 'فشل إظهار القصص' });
    }
});

// @route   GET /api/mobile/stories/:storyId/viewers
// @desc    من شاهد قصتي — العدد للجميع، الأسماء لمشترك هلا+
// @access  Private (صاحب القصة فقط)
router.get('/stories/:storyId/viewers', protect, async (req, res) => {
    try {
        const { storyId } = req.params;
        if (!mongoose.isValidObjectId(storyId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const story = await Story.findOne({ _id: storyId, user: req.user._id, status: 'active' }).lean();
        if (!story) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة', code: 'STORY_NOT_FOUND' });
        }

        if (!isPremiumActive(req.user)) {
            return res.json({
                success: true,
                data: { viewCount: story.viewCount || 0, screenshotCount: story.screenshotCount || 0, reactionCount: story.reactionCount || 0, viewers: [], isPremiumRequired: true }
            });
        }

        // 🚫 المحظورون بالاتجاهين لا يظهرون — مثل قائمة الزوار
        const blockedMeIds = await User.distinct('_id', { blockedUsers: req.user._id });
        const excluded = [...(req.user.blockedUsers || []), ...blockedMeIds];
        const views = await StoryView.find({ story: story._id, isHidden: false, viewer: { $nin: excluded } })
            .sort({ viewedAt: -1 })
            .limit(500)
            .populate('viewer', 'name profileImage country isActive bannedWords suspension verification.isVerified')
            .lean();

        res.json({
            success: true,
            data: {
                viewCount: story.viewCount || 0,
                screenshotCount: story.screenshotCount || 0,
                reactionCount: story.reactionCount || 0,
                viewers: views
                    .filter(v => v.viewer && !isUserFullyBanned(v.viewer))
                    .map(v => ({
                        viewer: {
                            _id: v.viewer._id,
                            name: v.viewer.name,
                            profileImage: getFullUrl(v.viewer.profileImage),
                            country: v.viewer.country,
                            isVerified: v.viewer.verification?.isVerified || false
                        },
                        viewedAt: v.viewedAt,
                        // 📸 التقط لقطة شاشة — اسمه لمشترك هلا+ فقط مثل المشاهدة
                        screenshotAt: v.screenshotAt || null,
                        // ❤️ تفاعل المشاهد — اسمه لهلا+ فقط مثل المشاهدة
                        reaction: v.reaction || null,
                        reactedAt: v.reactedAt || null
                    })),
                isPremiumRequired: false
            }
        });
    } catch (error) {
        console.error('خطأ في جلب مشاهدي القصة:', error);
        res.status(500).json({ success: false, message: 'فشل جلب المشاهدين' });
    }
});

// @route   DELETE /api/mobile/stories/:storyId
// @desc    حذف قصتي — المُبلَّغ عنها تُؤرشف (دليل للمشرف) بدل الحذف
// @access  Private (صاحب القصة)
router.delete('/stories/:storyId', protect, async (req, res) => {
    try {
        const { storyId } = req.params;
        if (!mongoose.isValidObjectId(storyId)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }
        const story = await Story.findOne({ _id: storyId, user: req.user._id, status: 'active' });
        if (!story) {
            return res.status(404).json({ success: false, message: 'القصة غير موجودة', code: 'STORY_NOT_FOUND' });
        }
        await require('../../utils/storySweeper').endStory(story, 'deleted');
        res.json({ success: true, message: 'تم حذف القصة' });
    } catch (error) {
        console.error('خطأ في حذف القصة:', error);
        res.status(500).json({ success: false, message: 'فشل حذف القصة' });
    }
});

module.exports = router;

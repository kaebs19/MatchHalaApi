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

const STORY_MAX_ACTIVE = 3;
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const STORY_MAX_EDGE = 1920;
const STATUS_MAX_USERS = 200;
const STORY_TEXT_MAX = 250;
const STORY_BACKGROUNDS = 8;   // عدد خلفيات القصة النصّية في التطبيق (0…7)

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

// القصص النشطة فعلاً — الكنس كل 5 دقائق، فالوقت يُفحص هنا أيضاً
const activeFilter = (extra = {}) => ({ status: 'active', expiresAt: { $gt: new Date() }, ...extra });

const serialize = (story, { owner = false, viewed = false } = {}) => ({
    _id: story._id,
    kind: story.kind || 'image',
    text: story.kind === 'text' ? story.text : undefined,
    background: story.kind === 'text' ? (story.background || 0) : undefined,
    imageUrl: getFullUrl(story.imageUrl),
    width: story.width,
    height: story.height,
    createdAt: story.createdAt,
    expiresAt: story.expiresAt,
    ...(owner ? { viewCount: story.viewCount || 0 } : { viewed })
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

        res.status(201).json({
            success: true,
            data: { story: serialize(story, { owner: true }), active: activeCount + 1, max: STORY_MAX_ACTIVE }
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
    const activeCount = await Story.countDocuments(activeFilter({ user: req.user._id }));
    if (activeCount >= STORY_MAX_ACTIVE) {
        return {
            status: 429,
            body: {
                success: false,
                message: `لديك ${STORY_MAX_ACTIVE} قصص نشطة — احذف واحدة أو انتظر انتهاءها`,
                code: 'STORY_LIMIT',
                data: { max: STORY_MAX_ACTIVE, active: activeCount }
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
        const active = await Story.countDocuments(activeFilter({ user: req.user._id }));
        res.status(201).json({ success: true, data: { story: serialize(story, { owner: true }), active, max: STORY_MAX_ACTIVE } });
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
            data: { stories: stories.map(s => serialize(s, { owner: true })), max: STORY_MAX_ACTIVE }
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

        const stories = await Story.find(activeFilter({ user: userId })).sort({ createdAt: 1 }).lean();
        let viewedSet = new Set();
        if (!isOwner && stories.length) {
            const seen = await StoryView.find({ viewer: req.user._id, story: { $in: stories.map(s => s._id) } })
                .select('story').lean();
            viewedSet = new Set(seen.map(v => String(v.story)));
        }

        res.json({
            success: true,
            data: { stories: stories.map(s => serialize(s, { owner: isOwner, viewed: viewedSet.has(String(s._id)) })) }
        });
    } catch (error) {
        console.error('خطأ في جلب قصص المستخدم:', error);
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
            { $match: activeFilter({ user: { $in: objectIds } }) },
            { $group: { _id: '$user', storyIds: { $push: '$_id' } } }
        ]);
        if (!grouped.length) return res.json({ success: true, data: { statuses: {} } });

        const ownerIds = grouped.map(g => g._id);
        const myBlocked = new Set((req.user.blockedUsers || []).map(String));
        const owners = await User.find({ _id: { $in: ownerIds } })
            .select('isActive bannedWords suspension blockedUsers').lean();
        const allowed = new Set(owners
            .filter(u => !isUserFullyBanned(u))
            .filter(u => !myBlocked.has(String(u._id)))
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
        const story = await Story.findOne(activeFilter({ _id: storyId })).select('user').lean();
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
                data: { viewCount: story.viewCount || 0, viewers: [], isPremiumRequired: true }
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
                        viewedAt: v.viewedAt
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

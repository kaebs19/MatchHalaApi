// MatchHala - Matches Routes
// مسارات التطابقات

const express = require('express');
const router = express.Router();
const Match = require('../models/Match');
const Conversation = require('../models/Conversation');
const Swipe = require('../models/Swipe');
const { protect, adminOnly } = require('../middleware/auth');

// Helper: تحويل المسار النسبي إلى URL كامل
const getFullUrl = (imgPath) => {
    if (!imgPath) return null;
    if (imgPath.startsWith('http')) return imgPath;
    const baseUrl = process.env.BASE_URL || 'https://halachat.khalafiati.io';
    return `${baseUrl}${imgPath}`;
};

// @route   GET /api/matches
// @desc    جلب جميع التطابقات
// @access  Protected
router.get('/', protect, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user._id;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const filter = {
            users: userId,
            isActive: true
        };

        const matches = await Match.find(filter)
            .populate('users', 'name profileImage birthDate gender country bio isOnline isPremium verification.isVerified lastLogin')
            .populate('conversation', '_id lastMessage')
            .sort({ createdAt: -1 })
            .limit(limitNum)
            .skip((pageNum - 1) * limitNum);

        const total = await Match.countDocuments(filter);

        // تنسيق البيانات - إظهار الطرف الآخر فقط
        const formattedMatches = matches.map(match => {
            const otherUser = match.users.find(u => u._id.toString() !== userId.toString());
            return {
                _id: match._id,
                conversationId: match.conversation?._id,
                createdAt: match.createdAt,
                user: otherUser ? {
                    _id: otherUser._id,
                    name: otherUser.name,
                    profileImage: getFullUrl(otherUser.profileImage),
                    birthDate: otherUser.birthDate,
                    gender: otherUser.gender,
                    country: otherUser.country,
                    bio: otherUser.bio,
                    isOnline: otherUser.isOnline,
                    isPremium: otherUser.isPremium,
                    isVerified: otherUser.verification?.isVerified || false
                } : null
            };
        });

        res.json({
            success: true,
            data: {
                matches: formattedMatches,
                total,
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب التطابقات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/matches/:id
// @desc    جلب تطابق محدد
// @access  Protected
router.get('/:id', protect, async (req, res) => {
    try {
        const match = await Match.findById(req.params.id)
            .populate('users', 'name profileImage birthDate gender country bio isOnline isPremium verification.isVerified')
            .populate('conversation');

        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'التطابق غير موجود'
            });
        }

        // التحقق من أن المستخدم جزء من التطابق
        const isParticipant = match.users.some(u => u._id.toString() === req.user._id.toString());
        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لعرض هذا التطابق'
            });
        }

        const otherUser = match.users.find(u => u._id.toString() !== req.user._id.toString());

        res.json({
            success: true,
            data: {
                match: {
                    _id: match._id,
                    conversationId: match.conversation?._id,
                    isActive: match.isActive,
                    createdAt: match.createdAt,
                    user: otherUser ? {
                        _id: otherUser._id,
                        name: otherUser.name,
                        profileImage: getFullUrl(otherUser.profileImage),
                        birthDate: otherUser.birthDate,
                        gender: otherUser.gender,
                        country: otherUser.country,
                        bio: otherUser.bio,
                        isOnline: otherUser.isOnline,
                        isPremium: otherUser.isPremium,
                        isVerified: otherUser.verification?.isVerified || false
                    } : null
                }
            }
        });

    } catch (error) {
        console.error('خطأ في جلب التطابق:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   DELETE /api/matches/:id
// @desc    إلغاء التطابق (Unmatch)
// @access  Protected
router.delete('/:id', protect, async (req, res) => {
    try {
        const match = await Match.findById(req.params.id);

        if (!match) {
            return res.status(404).json({
                success: false,
                message: 'التطابق غير موجود'
            });
        }

        // التحقق من أن المستخدم جزء من التطابق
        const isParticipant = match.users.some(u => u.toString() === req.user._id.toString());
        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لإلغاء هذا التطابق'
            });
        }

        // إلغاء التطابق
        match.isActive = false;
        match.unmatchedBy = req.user._id;
        await match.save();

        // إلغاء تفعيل المحادثة المرتبطة
        if (match.conversation) {
            await Conversation.findByIdAndUpdate(match.conversation, {
                isActive: false
            });
        }

        res.json({
            success: true,
            message: 'تم إلغاء التطابق بنجاح'
        });

    } catch (error) {
        console.error('خطأ في إلغاء التطابق:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/matches/admin/stats
// @desc    إحصائيات التطابقات (أدمن)
// @access  Admin
router.get('/admin/stats', protect, adminOnly, async (req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        const totalMatches = await Match.countDocuments();
        const activeMatches = await Match.countDocuments({ isActive: true });
        const unmatchedCount = await Match.countDocuments({ isActive: false });
        const matchesLast7Days = await Match.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
        const matchesLast30Days = await Match.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

        // نسبة التحويل: سوايبات → تطابقات
        const totalLikes = await Swipe.countDocuments({ type: { $in: ['like', 'superlike'] } });
        const matchRate = totalLikes > 0
            ? Math.round((totalMatches / totalLikes) * 100)
            : 0;

        res.json({
            success: true,
            data: {
                totalMatches,
                activeMatches,
                unmatchedCount,
                matchesLast7Days,
                matchesLast30Days,
                matchRate
            }
        });

    } catch (error) {
        console.error('خطأ في جلب إحصائيات التطابقات:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

module.exports = router;

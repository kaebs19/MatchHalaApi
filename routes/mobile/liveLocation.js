// MatchHala - Live Location Routes
// مشاركة موقع مباشر داخل محادثة: بدء، تحديث، إيقاف، واستعلام النشط.
//
// التصميم:
// - كل مشاركة لها فقاعة رسالة واحدة (type=text) تحمل نقطة البداية كنص، فالعملاء
//   القدامى يرونها موقعاً عادياً بدل رسالة مكسورة.
// - التحديثات تُبثّ عبر السوكِت فقط (لا رسائل جديدة) — وإلا امتلأت المحادثة.
// - الانتهاء زمني: expiresAt يُفحص عند كل تحديث وقراءة، بلا cron.

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { protect } = require('../../middleware/auth');
const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const LiveLocation = require('../../models/LiveLocation');

/// المدد المسموحة بالدقائق
const ALLOWED_DURATIONS = [15, 60];
/// أقل فاصل بين تحديثين مقبولين من نفس المشاركة — حارس ضد جهاز مندفع
const MIN_UPDATE_INTERVAL_MS = 5 * 1000;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isValidCoordinate(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number'
        && Number.isFinite(lat) && Number.isFinite(lng)
        && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function participantGuard(conversationId, userId) {
    if (!mongoose.Types.ObjectId.isValid(conversationId)) return null;
    const conversation = await Conversation.findById(conversationId)
        .select('participants lastMessage');
    if (!conversation) return null;
    const isParticipant = conversation.participants
        .some(p => p.toString() === userId.toString());
    return isParticipant ? conversation : null;
}

function emitToConversation(conversationId, event, payload) {
    if (!global.io) return;
    global.io.to(`conversation-${conversationId}`).emit(event, payload);
}

// ─────────────────────────────────────────────────────────────
// POST /live-location/start
// ─────────────────────────────────────────────────────────────
router.post('/live-location/start', protect, async (req, res) => {
    try {
        const { conversationId, durationMinutes, latitude, longitude, address, accuracy } = req.body;

        if (!ALLOWED_DURATIONS.includes(Number(durationMinutes))) {
            return res.status(400).json({
                success: false,
                message: 'مدة غير مدعومة'
            });
        }
        if (!isValidCoordinate(Number(latitude), Number(longitude))) {
            return res.status(400).json({
                success: false,
                message: 'إحداثيات غير صالحة'
            });
        }

        const conversation = await participantGuard(conversationId, req.user._id);
        if (!conversation) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية على هذه المحادثة' });
        }

        // مشاركة واحدة نشطة لكل مستخدم في كل محادثة — البدء يُنهي السابقة
        await LiveLocation.updateMany(
            {
                conversation: conversationId,
                sender: req.user._id,
                endedAt: null,
                expiresAt: { $gt: new Date() }
            },
            { $set: { endedAt: new Date() } }
        );

        const lat = Number(latitude);
        const lng = Number(longitude);
        const expiresAt = new Date(Date.now() + Number(durationMinutes) * 60 * 1000);

        // نقطة البداية بنفس صيغة الموقع العادي — عميل قديم يعرضها خريطة ساكنة
        const safeAddress = typeof address === 'string' ? address.slice(0, 200) : '';
        const content = `📍 ${lat.toFixed(6)},${lng.toFixed(6)}|${safeAddress}`;

        const message = await Message.create({
            conversation: conversationId,
            sender: req.user._id,
            type: 'text',
            content,
            status: 'sent'
        });

        const live = await LiveLocation.create({
            conversation: conversationId,
            sender: req.user._id,
            message: message._id,
            latitude: lat,
            longitude: lng,
            accuracy: typeof accuracy === 'number' ? accuracy : null,
            expiresAt
        });

        message.liveLocation = live._id;
        await message.save();

        conversation.lastMessage = message._id;
        await conversation.save();

        const populated = await Message.findById(message._id)
            .populate('sender', 'name profileImage isPremium verification.isVerified')
            .lean();
        populated.liveLocation = live.toClient();

        emitToConversation(conversationId, 'new-message', { message: populated });

        res.status(201).json({ success: true, data: live.toClient() });
    } catch (error) {
        console.error('❌ live-location/start:', error);
        res.status(500).json({ success: false, message: 'تعذّر بدء المشاركة' });
    }
});

// ─────────────────────────────────────────────────────────────
// PATCH /live-location/:id — تحديث الإحداثيات (بثّ سوكِت فقط)
// ─────────────────────────────────────────────────────────────
router.patch('/live-location/:id', protect, async (req, res) => {
    try {
        const { latitude, longitude, accuracy, heading } = req.body;

        if (!isValidCoordinate(Number(latitude), Number(longitude))) {
            return res.status(400).json({ success: false, message: 'إحداثيات غير صالحة' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }

        const live = await LiveLocation.findById(req.params.id);
        if (!live) {
            return res.status(404).json({ success: false, message: 'المشاركة غير موجودة' });
        }
        if (live.sender.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'المشاركة ليست لك' });
        }

        // انتهت بالوقت أو بالإيقاف — الجهاز يوقف الإرسال عند هذا الرد
        if (live.endedAt || live.expiresAt <= new Date()) {
            return res.status(410).json({
                success: false,
                message: 'انتهت المشاركة',
                data: live.toClient()
            });
        }

        // حارس ضد جهاز يرسل أسرع مما يلزم
        if (Date.now() - live.lastUpdateAt.getTime() < MIN_UPDATE_INTERVAL_MS) {
            return res.json({ success: true, data: live.toClient(), throttled: true });
        }

        live.latitude = Number(latitude);
        live.longitude = Number(longitude);
        live.accuracy = typeof accuracy === 'number' ? accuracy : live.accuracy;
        live.heading = typeof heading === 'number' ? heading : live.heading;
        live.lastUpdateAt = new Date();
        await live.save();

        emitToConversation(live.conversation, 'live-location-update', live.toClient());

        res.json({ success: true, data: live.toClient() });
    } catch (error) {
        console.error('❌ live-location/update:', error);
        res.status(500).json({ success: false, message: 'تعذّر التحديث' });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /live-location/:id/stop — إيقاف يدوي
// ─────────────────────────────────────────────────────────────
router.post('/live-location/:id/stop', protect, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
        }

        const live = await LiveLocation.findById(req.params.id);
        if (!live) {
            return res.status(404).json({ success: false, message: 'المشاركة غير موجودة' });
        }
        if (live.sender.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'المشاركة ليست لك' });
        }

        if (!live.endedAt) {
            live.endedAt = new Date();
            await live.save();
            emitToConversation(live.conversation, 'live-location-ended', live.toClient());
        }

        res.json({ success: true, data: live.toClient() });
    } catch (error) {
        console.error('❌ live-location/stop:', error);
        res.status(500).json({ success: false, message: 'تعذّر الإيقاف' });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /live-location/:conversationId — حالة المشاركات عند فتح المحادثة
// ─────────────────────────────────────────────────────────────
router.get('/live-location/:conversationId', protect, async (req, res) => {
    try {
        const conversation = await participantGuard(req.params.conversationId, req.user._id);
        if (!conversation) {
            return res.status(403).json({ success: false, message: 'لا تملك صلاحية على هذه المحادثة' });
        }

        // كل مشاركات المحادثة الحديثة — الفقاعة المنتهية تحتاج آخر موقع أيضاً
        const shares = await LiveLocation.find({ conversation: req.params.conversationId })
            .sort({ createdAt: -1 })
            .limit(20);

        res.json({
            success: true,
            data: shares.map(s => s.toClient())
        });
    } catch (error) {
        console.error('❌ live-location/get:', error);
        res.status(500).json({ success: false, message: 'تعذّر الجلب' });
    }
});

module.exports = router;

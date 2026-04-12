// routes/maintenance.js
// 🔧 Maintenance routes — admin control + public status check

const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { protect, adminOnly } = require('../middleware/auth');
const { invalidateMaintenanceCache } = require('../middleware/maintenance');
const pushNotificationService = require('../services/pushNotificationService');

// ═══════════════════════════════════════════════════════════════
// PUBLIC: حالة الصيانة الحالية (لا يحتاج auth)
// ═══════════════════════════════════════════════════════════════
router.get('/status', async (req, res) => {
    try {
        const settings = await Settings.findOne().select('maintenanceMode').lean();
        const maint = settings && settings.maintenanceMode;
        res.json({
            success: true,
            data: {
                enabled: !!(maint && maint.enabled),
                messageAr: maint?.messageAr || '',
                messageEn: maint?.messageEn || '',
                estimatedEndAt: maint?.estimatedEndAt || null,
                startedAt: maint?.startedAt || null,
                triggerType: maint?.triggerType || 'manual'
            }
        });
    } catch (error) {
        // في حال خطأ DB، نرجع enabled=false
        res.json({ success: true, data: { enabled: false } });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: تفعيل وضع الصيانة
// ═══════════════════════════════════════════════════════════════
router.post('/enable', protect, adminOnly, async (req, res) => {
    try {
        const { messageAr, messageEn, durationMinutes, allowAdmin } = req.body;

        const settings = await Settings.getSettings();

        const estimatedEndAt = durationMinutes
            ? new Date(Date.now() + Number(durationMinutes) * 60 * 1000)
            : null;

        settings.maintenanceMode = {
            enabled: true,
            messageAr: messageAr || 'نقوم بصيانة دورية لتحسين الخدمة. سنعود قريباً!',
            messageEn: messageEn || 'We are performing scheduled maintenance. We will be back soon!',
            estimatedEndAt,
            startedAt: new Date(),
            startedBy: req.user._id,
            triggerType: 'manual',
            allowAdmin: allowAdmin !== false
        };

        await settings.save();
        invalidateMaintenanceCache();

        // ✅ بث socket event لكل المتصلين
        if (global.io) {
            global.io.emit('maintenance-mode', {
                enabled: true,
                messageAr: settings.maintenanceMode.messageAr,
                messageEn: settings.maintenanceMode.messageEn,
                estimatedEndAt: settings.maintenanceMode.estimatedEndAt
            });
        }

        // ✅ إشعار push لكل المستخدمين
        try {
            await pushNotificationService.broadcastNotification(
                {
                    title: '🔧 وضع الصيانة',
                    body: settings.maintenanceMode.messageAr
                },
                {
                    type: 'maintenance_start',
                    estimatedEndAt: estimatedEndAt ? estimatedEndAt.toISOString() : ''
                }
            );
        } catch (e) {
            console.error('Push broadcast error:', e.message);
        }

        res.json({
            success: true,
            message: 'تم تفعيل وضع الصيانة',
            data: settings.maintenanceMode
        });
    } catch (error) {
        console.error('maintenance enable error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: إلغاء وضع الصيانة
// ═══════════════════════════════════════════════════════════════
router.post('/disable', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.getSettings();

        settings.maintenanceMode = {
            enabled: false,
            messageAr: settings.maintenanceMode?.messageAr || '',
            messageEn: settings.maintenanceMode?.messageEn || '',
            estimatedEndAt: null,
            startedAt: null,
            startedBy: null,
            triggerType: 'manual',
            allowAdmin: true
        };

        await settings.save();
        invalidateMaintenanceCache();

        // ✅ بث socket event
        if (global.io) {
            global.io.emit('maintenance-mode', { enabled: false });
        }

        // ✅ إشعار push للعودة
        try {
            await pushNotificationService.broadcastNotification(
                {
                    title: '✅ عاد التطبيق',
                    body: 'انتهت الصيانة. مرحباً بعودتك!'
                },
                { type: 'maintenance_end' }
            );
        } catch (e) {
            console.error('Push broadcast error:', e.message);
        }

        res.json({
            success: true,
            message: 'تم إلغاء وضع الصيانة'
        });
    } catch (error) {
        console.error('maintenance disable error:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN: حالة مفصّلة (مع كل الإعدادات)
// ═══════════════════════════════════════════════════════════════
router.get('/admin/details', protect, adminOnly, async (req, res) => {
    try {
        const settings = await Settings.findOne()
            .populate('maintenanceMode.startedBy', 'name email')
            .lean();
        res.json({
            success: true,
            data: settings?.maintenanceMode || {}
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'خطأ في الخادم' });
    }
});

module.exports = router;

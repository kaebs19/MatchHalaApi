// MatchHala - Violation Manager
// خدمة موحّدة لتسجيل مخالفات + إنشاء تنبيهات رسمية + إرسال إشعارات
// تُستخدم من:
//   - escalation middleware (عند التصعيد التلقائي/اليدوي)
//   - banned words filter (عند رصد كلمة محظورة)
//   - admin routes (عند حذف صورة/اسم/نبذة)
//   - reports (عند قبول بلاغ)

const Violation = require('../models/Violation');
const OfficialWarning = require('../models/OfficialWarning');
const { getTemplate } = require('../config/warningTemplates');
const { movePhotoToViolations } = require('./violationEvidence');

/**
 * إنشاء مخالفة مع دليل (مع نقل الصورة لمجلد محمي إن وجدت)
 *
 * @param {object} params
 * @param {string} params.userId - معرف المستخدم المُخالف
 * @param {string} params.type - نوع المخالفة (banned_word, photo, name, bio, behavior, ...)
 * @param {string} [params.reason] - السبب النصي
 * @param {string} [params.action] - الإجراء المتخذ
 * @param {number} [params.escalationLevel] - مستوى التصعيد بعد المخالفة
 * @param {string} [params.source='admin'] - المصدر
 * @param {string} [params.adminId] - معرف الأدمن
 * @param {object} [params.evidence] - بيانات الدليل
 * @param {string} [params.evidence.kind] - نوع الدليل
 * @param {string} [params.evidence.text] - نص الدليل
 * @param {string} [params.evidence.photoUrl] - رابط صورة تُنقل لمجلد المخالفات
 * @param {string} [params.evidence.messageId]
 * @param {string} [params.evidence.conversationId]
 * @param {string} [params.evidence.reportId]
 * @param {object} [params.evidence.metadata]
 * @param {string} [params.adminNotes]
 * @returns {Promise<Violation>}
 */
async function recordViolation(params) {
    const {
        userId,
        type,
        reason = null,
        action = 'warning',
        escalationLevel = 0,
        source = 'admin',
        adminId = null,
        evidence = {},
        adminNotes = null
    } = params;

    if (!userId || !type) {
        throw new Error('recordViolation: userId و type مطلوبان');
    }

    const evidenceData = {
        kind: evidence.kind || 'none',
        text: evidence.text || null,
        photoPath: null,
        originalPhotoPath: null,
        messageId: evidence.messageId || null,
        conversationId: evidence.conversationId || null,
        reportId: evidence.reportId || null,
        metadata: evidence.metadata || null
    };

    // إذا الدليل صورة → ننقلها لمجلد المخالفات
    if (evidence.photoUrl) {
        const moved = await movePhotoToViolations(userId, evidence.photoUrl);
        evidenceData.kind = 'photo';
        evidenceData.originalPhotoPath = moved.originalPath;
        evidenceData.photoPath = moved.publicUrl || moved.originalPath;
    }

    const violation = await Violation.create({
        user: userId,
        type,
        reason,
        action,
        escalationLevel,
        source,
        admin: adminId,
        evidence: evidenceData,
        adminNotes
    });

    return violation;
}

/**
 * إرسال تنبيه رسمي للمستخدم + حفظه في MongoDB + إرسال push.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.templateKey - مفتاح القالب (photo_violation, ...)
 * @param {string} [params.customTitle] - يستخدم مع template custom
 * @param {string} [params.customBody]
 * @param {string} [params.sentBy] - معرف الأدمن
 * @param {boolean} [params.isBlocking=true]
 * @param {object} [params.metadata]
 * @param {string} [params.violationId] - ربط بمخالفة
 * @returns {Promise<OfficialWarning>}
 */
async function sendOfficialWarning(params) {
    const {
        userId,
        templateKey,
        customTitle,
        customBody,
        sentBy = null,
        isBlocking,
        metadata = null,
        violationId = null
    } = params;

    if (!userId || !templateKey) {
        throw new Error('sendOfficialWarning: userId و templateKey مطلوبان');
    }

    const template = getTemplate(templateKey);
    if (!template) {
        throw new Error(`sendOfficialWarning: قالب غير موجود: ${templateKey}`);
    }

    // بناء البيانات (custom يحتاج title+body من المُرسل)
    const title = templateKey === 'custom' ? (customTitle || 'تنبيه من الإدارة') : template.title;
    const body = templateKey === 'custom' ? (customBody || '') : template.body;

    if (!body || !body.trim()) {
        throw new Error('sendOfficialWarning: النص فارغ');
    }

    const warning = await OfficialWarning.create({
        user: userId,
        type: templateKey,
        title,
        body,
        severity: template.severity,
        icon: template.icon,
        isBlocking: typeof isBlocking === 'boolean' ? isBlocking : template.isBlocking,
        sentBy,
        metadata,
        violation: violationId
    });

    // ربط المخالفة بالتنبيه (لو موجود violationId)
    if (violationId) {
        try {
            await Violation.findByIdAndUpdate(violationId, { officialWarning: warning._id });
        } catch (e) { /* ignore */ }
    }

    // إرسال Push + حفظ Notification
    try {
        const pushService = require('../services/pushNotificationService');
        await pushService.sendNotificationToUser(userId, {
            title: `${template.icon} ${title}`,
            body
        }, {
            type: 'official_warning',
            warningId: String(warning._id),
            templateKey,
            severity: template.severity,
            isBlocking: warning.isBlocking,
            senderId: sentBy ? String(sentBy) : undefined
        });
    } catch (e) {
        console.error('⚠️ push error (official warning):', e.message);
    }

    // Socket.IO — إبلاغ التطبيق فوراً بعرض الـ Modal
    try {
        if (global.io) {
            global.io.to(`user:${userId}`).emit('official-warning', {
                _id: warning._id,
                type: warning.type,
                title: warning.title,
                body: warning.body,
                severity: warning.severity,
                icon: warning.icon,
                isBlocking: warning.isBlocking,
                sentAt: warning.sentAt
            });
        }
    } catch (e) { /* ignore */ }

    return warning;
}

module.exports = {
    recordViolation,
    sendOfficialWarning
};

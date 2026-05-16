const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const User = require('../../models/User');
const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const Notification = require('../../models/Notification');
const FlaggedMessage = require('../../models/FlaggedMessage');
const { protect } = require('../../middleware/auth');
const { spamCheckMiddleware } = require('../../middleware/spamDetection');
const pushNotificationService = require('../../services/pushNotificationService');
const { checkBannedWords } = require('../bannedWords');
const { detectExternalPromotion, recordExternalPromoViolation, isMessagingLockedByPromo, looksLikeExternalHandle } = require('../../utils/externalPromotionDetector');
const { checkMultiMessageNumbers } = require('../../utils/multiMessageNumberDetector');
const { checkMultiMessageLetters, clearLetterBuffer } = require('../../utils/multiMessageLetterDetector');
const { getFullUrl, getBestUserImage, getUserImage, uploadMessageImage, uploadMessageAudio, isUserFullyBanned } = require('./helpers');
const { clientSupports } = require('../../utils/versionCompare');
const Settings = require('../../models/Settings');

// ==========================================
// نظام الرسائل
// ==========================================

// @route   POST /api/mobile/messages/send
// @desc    إرسال رسالة
// @access  Private
router.post('/messages/send', protect, spamCheckMiddleware, async (req, res) => {
    // 🔬 DEBUG: log every entry to this route
    console.log(`[ROUTE-SEND] user=${String(req.user?._id).slice(-6)} content="${req.body?.content}" type=${req.body?.type || 'text'} convId=${String(req.body?.conversationId).slice(-6)}`);
    try {
        const { conversationId, content, type = 'text', mediaUrl, mediaMetadata, replyTo } = req.body;

        // ✅ فحص تقييد المراسلة
        if (req.user.restrictions?.messagingRestricted) {
            const now = new Date();
            const until = req.user.restrictions.messagingRestrictedUntil;
            if (!until || now < until) {
                const level = req.user.restrictions.messagingRestrictedLevel;
                if (level === 'all') {
                    return res.status(403).json({
                        success: false,
                        message: 'حسابك مقيّد من إرسال الرسائل مؤقتاً',
                        code: 'MESSAGING_RESTRICTED',
                        data: {
                            level: 'all',
                            until: until?.toISOString(),
                            reason: req.user.restrictions.restrictionReason
                        }
                    });
                }
                // level === 'new_only': يُسمح لو المحادثة موجودة فعلاً (يُفحص لاحقاً)
            }
        }

        // ✅ validation: محتوى الرسالة مطلوب
        if (!content || !content.trim()) {
            return res.status(400).json({ success: false, message: 'محتوى الرسالة مطلوب' });
        }

        // فحص حظر الكلمات المحظورة
        if (req.user.bannedWords?.isBanned) {
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك بسبب مخالفات متكررة',
                code: 'USER_BANNED'
            });
        }

        if (!conversationId) {
            return res.status(400).json({
                success: false,
                message: 'معرف المحادثة والمحتوى مطلوبان'
            });
        }

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email deviceToken isActive bannedWords suspension');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // ✅ منع إرسال/الرد لمستخدم موقوف بشكل كامل
        const anyRecipientBanned = conversation.participants.some(
            p => p._id.toString() !== req.user._id.toString() && isUserFullyBanned(p)
        );
        if (anyRecipientBanned) {
            return res.status(403).json({
                success: false,
                message: 'لا يمكن إرسال رسالة — المستخدم موقوف',
                code: 'RECIPIENT_SUSPENDED'
            });
        }

        // التحقق من أن المحادثة نشطة
        if (!conversation.isActive) {
            return res.status(400).json({
                success: false,
                message: 'المحادثة غير نشطة'
            });
        }

        // لو معلقة، بس المنشئ يقدر يرسل
        if (conversation.status === 'pending') {
            if (conversation.creator.toString() !== req.user._id.toString()) {
                return res.status(400).json({
                    success: false,
                    message: 'لا يمكنك الإرسال حتى تقبل المحادثة'
                });
            }
        }

        // ✅ Phase 2: لو messaging مقفول بسبب external promo violations → ارفض الإرسال
        if (isMessagingLockedByPromo(req.user)) {
            const lockedUntil = req.user.restrictions.messagingRestrictedUntil;
            const hoursLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 60 * 1000));
            return res.status(403).json({
                success: false,
                message: `تم تقييد المراسلة لمدة ${hoursLeft} ساعة بسبب محاولات متكررة لمشاركة حسابات خارجية`,
                code: 'MESSAGING_LOCKED_PROMO',
                lockedUntil
            });
        }

        // فحص الكلمات المحظورة + الترويج الخارجي (Snap/Insta/...)
        let censoredContent = content;
        let bannedResult = { hasBannedWords: false, matchedWords: [], categories: [] };
        let externalPromoDetected = false;
        let externalPromoCategories = [];
        let externalPromoViolation = null;
        if (type === 'text' && content) {
            // 1. ترويج خارجي — يُفحَص أولاً على النص الأصلي (قبل أي censoring)
            //    أولوية على banned words لأن الحسابات الخارجية تحتاج violation tracking منفصل
            //    ولا نريد أن يطمسها banned-words filter قبل أن يلتقطها الـ detector
            const promo = detectExternalPromotion(content);
            const originalContent = content;
            if (promo.detected) {
                censoredContent = promo.redacted;
                externalPromoDetected = true;
                externalPromoCategories = promo.categories;
                externalPromoViolation = await recordExternalPromoViolation(req.user, {
                    source: 'message',
                    categories: promo.categories,
                    patterns: promo.patterns,
                    conversationId,
                    originalText: originalContent
                });
            }

            // 2. كلمات محظورة — تُفحَص فقط لو لم يُكتشف ترويج خارجي
            //    (لو فيه كلاهما، الـ external promo يأخذ الأولوية)
            if (!externalPromoDetected) {
                bannedResult = await checkBannedWords(content);
                if (bannedResult.hasBannedWords) {
                    censoredContent = bannedResult.censoredText;

                    // ✅ تصنيف ذكي للـ external promo:
                    //   (أ) category صريح = contact / promotion
                    //   (ب) heuristic: الكلمة تشبه handle (underscore، mix letters+digits، @، إلخ)
                    //       حتى لو الأدمن وضعها بـ category=spam/other بالخطأ
                    const externalCats = (bannedResult.categories || []).filter(c =>
                        c === 'contact' || c === 'promotion'
                    );
                    const handleLikeWords = (bannedResult.matchedWords || []).filter(looksLikeExternalHandle);
                    const treatAsExternal = externalCats.length > 0 || handleLikeWords.length > 0;

                    if (treatAsExternal) {
                        externalPromoDetected = true;
                        externalPromoCategories = externalCats.length > 0
                            ? externalCats
                            : ['handle_pattern']; // عُلِّمت كـ external بسبب الـ heuristic
                        externalPromoViolation = await recordExternalPromoViolation(req.user, {
                            source: 'message',
                            categories: externalPromoCategories,
                            patterns: bannedResult.matchedWords,
                            conversationId,
                            originalText: content,
                            tactic: externalCats.length > 0 ? 'banned_word_contact' : 'handle_heuristic'
                        });
                    }
                }
            }

            // 3. Multi-Message Number Detection — كشف الأرقام المُقسَّمة على رسائل
            //    (تكتيك التحايل: 124 → 134 → 876 = 124134876 = Zinji ID محتمل)
            //    لا يُفحَص لو اكتُشف external promo بالفعل (موجود تحذيره)
            if (!externalPromoDetected) {
                const multiNum = checkMultiMessageNumbers(
                    String(req.user._id),
                    String(conversationId),
                    content
                );
                if (multiNum.detected) {
                    censoredContent = '***';
                    externalPromoDetected = true;
                    externalPromoCategories = ['split_number'];
                    externalPromoViolation = await recordExternalPromoViolation(req.user, {
                        source: 'message',
                        categories: ['split_number'],
                        patterns: [`[multi-msg:${multiNum.combinedDigits}]`],
                        conversationId,
                        originalText: `${originalContent} (combined: ${multiNum.combinedDigits} across ${multiNum.bufferSize} msgs)`
                    });
                }
            }
        }

        // ✅ Phase 1.2: Sensitive Content — هل نحفظ النص الأصلي للكشف لاحقاً؟
        // الشروط: الميزة مفعّلة + الكلمة من category مشمولة + ليس external promo
        // (external promo يبقى محجوب نهائياً — قرار سياسة)
        //
        // ⚠️ ملاحظة: لا نفحص نسخة المُرسِل لأن:
        // - النص دائماً يُحفظ مكتوماً (content = "***")
        // - مستلم v6.2 يرى المكتوم (لا يضرّه)
        // - مستلم v6.3 يقدر يكشف لو فعّل الإعداد
        // - المُرسِل لا يجب أن يُعاقَب لمجرد كونه على نسخة قديمة
        let sensitiveFlag = { hasFlaggedContent: false, flaggedCategory: null, originalContent: null };
        if (bannedResult.hasBannedWords && !externalPromoDetected && bannedResult.categories?.length > 0) {
            try {
                const settings = await Settings.getSettings();
                const sc = settings.sensitiveContent || {};
                const matchedCategory = bannedResult.categories.find(c => (sc.affectedCategories || []).includes(c));

                if (sc.featureEnabled && matchedCategory) {
                    sensitiveFlag = {
                        hasFlaggedContent: true,
                        flaggedCategory: matchedCategory,
                        originalContent: content
                    };
                }
            } catch (scErr) {
                console.error('SensitiveContent flag check error:', scErr.message);
            }
        }

        // إنشاء الرسالة (بالمحتوى المفلتر)
        const messageData = {
            conversation: conversationId,
            sender: req.user._id,
            content: censoredContent,
            type,
            mediaUrl: mediaUrl || null,
            mediaMetadata: mediaMetadata || null,
            status: 'sent',
            // Phase 1.2: Sensitive Content fields (additive — التطبيق القديم يتجاهلها)
            hasFlaggedContent: sensitiveFlag.hasFlaggedContent,
            flaggedCategory: sensitiveFlag.flaggedCategory,
            originalContent: sensitiveFlag.originalContent
        };
        if (replyTo) messageData.replyTo = replyTo;

        let message = await Message.create(messageData);

        // ════════════════════════════════════════════════════════════════
        // 🔍 Multi-Message Letter Detection (Anti-Evasion)
        // ════════════════════════════════════════════════════════════════
        // المستخدم يحاول التحايل بتقسيم اسم الحساب الخارجي على عدة رسائل:
        //   "س" → "ن" → "ا" → "ب" = "سناب"
        // الـ buffer يتتبع آخر القطع. عند الكشف:
        //   1. الرسائل السابقة + الحالية → content = "***"
        //   2. socket emit للمستلم لتحديث UI
        //   3. violations += 2 (عقوبة مضاعفة لأن التحايل متعمد)
        let multiLetterDetection = null;
        // 🔬 DEBUG entry
        console.log(`[MML-MSG] before check: content="${content}" type=${type} externalPromoDetected=${externalPromoDetected}`);
        if (!externalPromoDetected && type === 'text') {
            multiLetterDetection = await checkMultiMessageLetters(
                String(req.user._id),
                String(conversationId),
                content,
                message._id.toString()
            );

            if (multiLetterDetection.detected) {
                // 1. حدّث كل الرسائل المعنية (الحالية + السابقة) → ***
                const idsToFlag = multiLetterDetection.bufferedMessageIds || [];
                if (idsToFlag.length > 0) {
                    await Message.updateMany(
                        { _id: { $in: idsToFlag } },
                        {
                            $set: {
                                content: '***',
                                hasFlaggedContent: true,
                                flaggedCategory: 'external_promo_split'
                            }
                        }
                    );
                    // إعادة جلب الرسالة الحالية بعد التحديث
                    message = await Message.findById(message._id);
                }

                // 2. socket emit retroactive للمحادثة (المستلم يحدّث الرسائل السابقة)
                try {
                    global.io.to(`conversation-${conversationId}`).emit('messages-retroactive-flagged', {
                        conversationId,
                        messageIds: idsToFlag,
                        reason: 'external_promo_split_letters',
                        tactic: 'split_letters',
                        combinedWord: multiLetterDetection.combinedWord,
                        categories: multiLetterDetection.categories
                    });
                } catch (emitErr) { /* غير حرج */ }

                // 3. record violation مع عقوبة مضاعفة (weight: 2)
                externalPromoCategories = multiLetterDetection.categories;
                externalPromoDetected = true;
                censoredContent = '***';
                externalPromoViolation = await recordExternalPromoViolation(req.user, {
                    source: 'message',
                    categories: multiLetterDetection.categories,
                    patterns: multiLetterDetection.patterns,
                    conversationId,
                    originalText: `${content} (split: ${multiLetterDetection.combinedWord})`,
                    tactic: 'split_letters',
                    weight: 2,
                    messageId: message._id
                });

                // ✅ مسح الـ buffer (تم الالتقاط — تجنّب double-trigger)
                await clearLetterBuffer(String(req.user._id), String(conversationId));
            }
        }
        // ════════════════════════════════════════════════════════════════

        // إذا فيها كلمات محظورة → أضفها لقائمة المراجعة + تنبيه أدمن + حظر تلقائي
        // ✅ Phase 2: استثناء — لو الميزة مفعّلة وكل الكلمات في sensitive categories
        // → لا تُسجَّل كمخالفة (المستخدم اختار وعياً + المستلم يقدر يطفئ الكشف)
        let userViolations = 0;
        let skipViolationTracking = false;
        if (sensitiveFlag.hasFlaggedContent && bannedResult.hasBannedWords) {
            const scSettings = await Settings.getSettings();
            const allowedCats = scSettings.sensitiveContent?.affectedCategories || [];
            // كل الكلمات الـ matched من categories مسموح بها → استثناء كامل
            skipViolationTracking = bannedResult.categories.every(c => allowedCats.includes(c));
        }

        if (bannedResult.hasBannedWords && !skipViolationTracking) {
            // تحديد المستقبل (الطرف الآخر في المحادثة)
            const receiverId = conversation.participants.find(
                p => p._id.toString() !== req.user._id.toString()
            )?._id;

            await FlaggedMessage.create({
                message: message._id,
                conversation: conversationId,
                sender: req.user._id,
                receiver: receiverId,
                originalContent: content,
                matchedWords: bannedResult.matchedWords
            });

            // ✅ تسجيل Violation في السجل الموحّد (مع الرسالة الأصلية كـ دليل)
            try {
                const Violation = require('../../models/Violation');
                await Violation.create({
                    user: req.user._id,
                    type: 'banned_word',
                    reason: `كلمات محظورة: ${bannedResult.matchedWords.join(', ')}`,
                    action: 'warning',
                    source: 'banned_words_filter',
                    evidence: {
                        kind: 'message',
                        text: content,
                        messageId: message._id,
                        conversationId: conversationId,
                        metadata: { matchedWords: bannedResult.matchedWords }
                    }
                });
            } catch (vErr) { console.error('violation (banned_word) error:', vErr.message); }

            // ✅ زيادة عدد المخالفات (حد يومي — يُعاد العدّاد كل يوم جديد)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const lastViolationDate = req.user.bannedWords?.lastViolationDate;
            const lastDate = lastViolationDate ? new Date(lastViolationDate) : null;
            const isNewDay = !lastDate || lastDate < today;

            const updateQuery = isNewDay
                ? { $set: { 'bannedWords.violations': 1, 'bannedWords.lastViolationDate': new Date() } }
                : { $inc: { 'bannedWords.violations': 1 }, $set: { 'bannedWords.lastViolationDate': new Date() } };

            const updatedUser = await User.findByIdAndUpdate(req.user._id, updateQuery, { new: true });
            userViolations = updatedUser.bannedWords?.violations || 1;

            // ✅ حد المخالفات من الإعدادات (افتراضي 3)
            const Settings = require('../../models/Settings');
            const appSettings = await Settings.getSettings();
            const maxViolations = appSettings.maxBannedWordViolations || 5;

            // ✅ إشعار تحذيري عند اقتراب الحظر (بقي مخالفتين أو أقل)
            const remaining = maxViolations - userViolations;
            if (remaining > 0 && remaining <= 2) {
                try {
                    await pushNotificationService.sendNotificationToUser(req.user._id, {
                        title: '⚠️ تنبيه تلقائي: اقتربت من الحظر',
                        body: `رصد نظام الحماية ${userViolations}/${maxViolations} مخالفات. تبقى ${remaining} ${remaining === 1 ? 'مخالفة' : 'مخالفتين'} قبل إيقاف الحساب تلقائياً.`
                    }, { type: 'system' });

                    await Notification.create({
                        title: '⚠️ تنبيه تلقائي: اقتربت من الحظر',
                        body: `لديك ${userViolations}/${maxViolations} مخالفة. يُرجى الالتزام بسياسة الاستخدام لتجنّب إيقاف الحساب تلقائياً.`,
                        type: 'system',
                        recipients: 'specific',
                        targetUsers: [req.user._id],
                        status: 'sent',
                        sentAt: new Date()
                    });
                } catch (warnErr) {
                    console.error('خطأ في إرسال تحذير الحظر:', warnErr.message);
                }
            }

            // حظر تلقائي عند الوصول للحد
            if (userViolations >= maxViolations) {
                await User.findByIdAndUpdate(req.user._id, {
                    'bannedWords.isBanned': true,
                    'bannedWords.bannedAt': new Date(),
                    'bannedWords.banReason': `حظر تلقائي - ${maxViolations} مخالفات كلمات محظورة`,
                    isActive: false
                });
            }

            // تنبيه جميع الأدمن
            try {
                const admins = await User.find({ role: 'admin' }, '_id').lean();
                const banText = userViolations >= maxViolations ? ' (تم حظر الحساب تلقائياً!)' : ` (مخالفة ${userViolations}/${maxViolations})`;
                for (const admin of admins) {
                    await pushNotificationService.sendNotificationToUser(admin._id, {
                        title: '⚠️ رسالة محظورة',
                        body: `${req.user.name} أرسل كلمات محظورة: ${bannedResult.matchedWords.join(', ')}${banText}`
                    }, { type: 'flagged_message', conversationId, senderId: req.user._id.toString() });
                }
                // Socket event للـ admin dashboard
                if (global.io) {
                    global.io.emit('admin-flagged-message', {
                        sender: req.user.name,
                        senderId: req.user._id,
                        matchedWords: bannedResult.matchedWords,
                        violations: userViolations,
                        maxViolations: maxViolations,
                        autoBanned: userViolations >= maxViolations
                    });
                }
            } catch (notifErr) {
                console.error('خطأ في إرسال تنبيه الأدمن:', notifErr.message);
            }
        }

        // تحديث آخر رسالة + عداد الرسائل
        conversation.lastMessage = message._id;
        if (!conversation.metadata) conversation.metadata = {};
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        await conversation.save();

        // جلب الرسالة مع بيانات المرسل + الرد + originalContent (للمرسل فقط)
        const populatedMessage = await Message.findById(message._id)
            .select('+originalContent')
            .populate('sender', 'name email profileImage isPremium isActive verification.isVerified')
            .populate({
                path: 'replyTo',
                select: 'content type sender mediaUrl',
                populate: { path: 'sender', select: 'name' }
            }).lean();

        // ✅ senderMessage: للمرسل ولـ HTTP response — content = originalContent
        // (iOS Message struct لا يحتوي originalContent، نضع الأصلي في content
        //  مباشرة حتى يعرض المرسل نصه دون تعديل iOS)
        const senderMessage = { ...populatedMessage };
        if (senderMessage.hasFlaggedContent && senderMessage.originalContent) {
            senderMessage.content = senderMessage.originalContent;
        }
        delete senderMessage.originalContent;

        // ✅ broadcastMessage: للمستلم — content يبقى مكتوماً (***)
        const broadcastMessage = { ...populatedMessage };
        delete broadcastMessage.originalContent;

        // إرسال عبر Socket.IO
        if (global.io) {
            // ✅ غرفة المرسل الخاصة → النسخة الكاملة (نص أصلي)
            // مهم لو المرسل لديه أكثر من جلسة (نفس الحساب على أكثر من جهاز)
            global.io.to(`user:${req.user._id}`).emit('new-message', {
                message: senderMessage
            });

            // ✅ غرفة المستخدم الخاصة للمستلمين → نسخة مُجرَّدة (مكتومة)
            const otherParticipants = conversation.participants.filter(
                p => p._id.toString() !== req.user._id.toString()
            );
            for (const participant of otherParticipants) {
                global.io.to(`user:${participant._id}`).emit('new-message', {
                    message: broadcastMessage
                });
            }

            // ✅ غرفة المحادثة — للأدمن المراقب أو واجهات أخرى (نسخة مكتومة آمنة)
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: broadcastMessage
            });
        }

        // إرسال إشعارات للمستقبلين الـ offline فقط عبر FCM
        const recipients = conversation.participants.filter(
            p => p._id.toString() !== req.user._id.toString()
        );

        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();

            // تحقق هل المستقبل متصل بالسوكت
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);

            if (!isOnline) {
                // إرسال Push Notification عبر Firebase للـ offline users فقط
                await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    type === 'text' ? (content.length > 100 ? content.substring(0, 100) + '...' : content) : `أرسل ${type === 'image' ? 'صورة' : type === 'audio' ? 'رسالة صوتية' : type === 'video' ? 'فيديو' : 'ملف'}`,
                    conversationId,
                    getBestUserImage(req.user),
                    req.user._id
                );
            }
        }

        const response = {
            success: true,
            message: 'تم إرسال الرسالة',
            data: { message: senderMessage }   // ✅ النسخة الكاملة للمرسل
        };

        // تحذير المرسل — فقط لو المخالفة مسجَّلة (لا نزعجه لو محتوى حساس مسموح)
        if (bannedResult.hasBannedWords && !skipViolationTracking) {
            const Settings = require('../../models/Settings');
            const appSettings = await Settings.getSettings();
            const maxViol = appSettings.maxBannedWordViolations || 3;
            response.warning = {
                message: 'تم اكتشاف كلمات غير لائقة في رسالتك',
                violations: userViolations,
                maxViolations: maxViol,
                banned: userViolations >= maxViol
            };
        } else if (bannedResult.hasBannedWords && skipViolationTracking) {
            // ✅ إشعار شفافية للمرسل — يخبره كيف سيرى المستلم الرسالة
            // (طبيعية لو فعّل المحتوى الحساس، مخفية لو لم يفعّل)
            const receiverId = conversation.participants.find(
                p => p._id.toString() !== req.user._id.toString()
            )?._id;

            let receiverSeesRevealed = false;
            if (receiverId) {
                try {
                    const receiver = await User.findById(receiverId)
                        .select('privacySettings.allowSensitiveContent').lean();
                    receiverSeesRevealed = receiver?.privacySettings?.allowSensitiveContent === true;
                } catch (rcErr) { /* تجاهل — افتراضي blurred */ }
            }

            response.sensitiveContentNotice = {
                message: receiverSeesRevealed
                    ? 'تم إرسال رسالتك. المستلم فعّل عرض المحتوى الحساس وسيراها طبيعياً.'
                    : 'تم إرسال رسالتك. ستظهر مخفية للمستلم لأنه لم يفعّل عرض المحتوى الحساس.',
                category: sensitiveFlag.flaggedCategory,
                receiverWillSee: receiverSeesRevealed ? 'revealed' : 'blurred',
                soft: true
            };
        }

        // ✅ تحذير عند اكتشاف ترويج خارجي (Snap/Insta/...) — sheet احترافي على iOS
        if (externalPromoDetected) {
            const v = externalPromoViolation?.violations || 0;
            const t = externalPromoViolation?.threshold || 5;
            const lockCount = externalPromoViolation?.lockCount || 0;
            const durationHours = externalPromoViolation?.durationHours || 0;

            response.externalPromoBlocked = {
                // عنوان الـ sheet
                title: externalPromoViolation?.suspended ? 'تم تعليق حسابك' :
                       externalPromoViolation?.lockApplied ? `تم تقييد حسابك (التقييد رقم ${lockCount})` :
                       'تم حجب رسالتك',
                // الرسالة الأساسية (احترافية + شاملة)
                message: 'تم التعرف تلقائياً على مشاركة حساب خارجي. سياسة المنصة تمنع ذلك، وتكرار مشاركة حسابات أو أرقام يقيّد حسابك آلياً.',
                // رسالة السيرفر التفصيلية (مع المدة ورقم التقييد)
                serverMessage: externalPromoViolation?.message || null,
                categories: externalPromoCategories,
                violations: v,
                threshold: t,
                // ✅ معلومات التصعيد التدريجي
                lockCount,
                durationHours,
                // severity للـ iOS
                severity: externalPromoViolation?.suspended ? 'suspended' :
                          externalPromoViolation?.lockApplied ? 'locked' :
                          v >= t - 1 ? 'last_warning' :
                          v > 1 ? 'repeated' : 'first',
                lockApplied: externalPromoViolation?.lockApplied || false,
                suspended: externalPromoViolation?.suspended || false
            };

            // ✅ بث لحظي للمرسل
            try {
                global.io.to(`user:${req.user._id}`).emit('external-promo-warning', {
                    conversationId,
                    ...response.externalPromoBlocked
                });
            } catch (emitErr) { /* غير حرج */ }
        }

        res.status(201).json(response);

    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/messages/send-image
// @desc    إرسال صورة — يستقبل conversationId من body (للتوافق مع تطبيق iOS)
// @access  Private
router.post('/messages/send-image', protect, uploadMessageImage.single('image'), async (req, res) => {
    // أعد التوجيه لنفس المنطق مع أخذ conversationId من body
    req.params.conversationId = req.body.conversationId;

    if (!req.params.conversationId) {
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(400).json({
            success: false,
            message: 'conversationId مطلوب'
        });
    }

    // أكمل مع نفس handler الموجود
    try {
        const { conversationId } = req.params;
        const senderId = req.user._id;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع صورة'
            });
        }

        // فحص حد الصور اليومي (2 للعادي، لا حد للبريميوم)
        if (!req.user.isPremium) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const imageCount = await Message.countDocuments({
                sender: senderId,
                type: 'image',
                createdAt: { $gte: today }
            });
            if (imageCount >= 2) {
                if (req.file) fs.unlinkSync(req.file.path);
                return res.status(429).json({
                    success: false,
                    message: 'وصلت للحد اليومي (2 صور). اشترك في Premium لإرسال بلا حدود',
                    code: 'IMAGE_LIMIT_REACHED',
                    data: { dailyLimit: 2, sent: imageCount }
                });
            }
        }

        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email deviceToken');

        if (!conversation) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        const isParticipant = conversation.participants.some(
            p => p._id.toString() === senderId.toString()
        );

        if (!isParticipant) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
        const mediaUrl = `${baseUrl}/uploads/messages/${req.file.filename}`;

        // ✅ بيانات الصورة المؤقتة ومصدرها
        const imageSource = req.body.imageSource || null; // 'camera' | 'gallery'
        const disappearingDuration = req.body.disappearingDuration ? parseInt(req.body.disappearingDuration) : null; // ثواني

        const messageData = {
            conversation: conversationId,
            sender: senderId,
            type: 'image',
            mediaUrl: mediaUrl,
            content: req.body.caption || '',
            status: 'sent'
        };

        // مصدر الصورة
        if (imageSource) {
            messageData.imageSource = imageSource;
        }

        // صورة مؤقتة (تختفي)
        if (disappearingDuration && [5, 10, 30].includes(disappearingDuration)) {
            messageData.disappearing = {
                enabled: true,
                duration: disappearingDuration,
                expiresAt: null, // يتم تعيينه عند المشاهدة
                viewedBy: []
            };
        }

        const message = await Message.create(messageData);

        conversation.lastMessage = message._id;
        await conversation.save();

        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name profileImage isPremium verification.isVerified').lean();

        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
        }

        const recipients = conversation.participants.filter(
            p => p._id.toString() !== senderId.toString()
        );

        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);

            if (!isOnline && recipient.deviceToken) {
                try {
                    await pushNotificationService.sendNewMessageNotification(
                        recipient._id || recipient,
                        req.user.name || req.user,
                        disappearingDuration ? '📷 صورة مؤقتة' : '📷 صورة',
                        conversationId,
                        getBestUserImage(req.user),
                        req.user._id
                    );
                } catch (pushErr) {
                    console.error('Push error:', pushErr.message);
                }
            }
        }

        res.json({
            success: true,
            data: {
                message: {
                    _id: populatedMessage._id,
                    conversationId: conversationId,
                    sender: populatedMessage.sender?._id || senderId,
                    senderUser: populatedMessage.sender,
                    content: populatedMessage.content,
                    type: populatedMessage.type,
                    mediaUrl: populatedMessage.mediaUrl,
                    imageSource: populatedMessage.imageSource,
                    disappearing: populatedMessage.disappearing,
                    isRead: false,
                    createdAt: populatedMessage.createdAt,
                    updatedAt: populatedMessage.updatedAt
                }
            }
        });
    } catch (error) {
        console.error('Send image error:', error);
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
        }
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في إرسال الصورة',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/messages/send-audio
// @desc    إرسال رسالة صوتية (multipart/form-data)
// @access  Private
router.post('/messages/send-audio', protect, uploadMessageAudio.single('audio'), async (req, res) => {
    try {
        const { conversationId, duration, waveform, replyTo } = req.body;
        const senderId = req.user._id;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'لم يتم رفع ملف صوتي' });
        }

        if (!conversationId) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(400).json({ success: false, message: 'conversationId مطلوب' });
        }

        // ✅ فحص تقييد المراسلة
        if (req.user.restrictions?.messagingRestricted) {
            const now = new Date();
            const until = req.user.restrictions.messagingRestrictedUntil;
            if (!until || now < until) {
                const level = req.user.restrictions.messagingRestrictedLevel;
                if (level === 'all') {
                    try { fs.unlinkSync(req.file.path); } catch (e) {}
                    return res.status(403).json({
                        success: false,
                        message: 'حسابك مقيّد من إرسال الرسائل مؤقتاً',
                        code: 'MESSAGING_RESTRICTED'
                    });
                }
            }
        }

        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email deviceToken');

        if (!conversation) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(404).json({ success: false, message: 'المحادثة غير موجودة' });
        }

        const isParticipant = conversation.participants.some(
            p => p._id.toString() === senderId.toString()
        );
        if (!isParticipant) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(403).json({ success: false, message: 'ليس لديك صلاحية لهذه المحادثة' });
        }

        // ✅ منع إرسال الرسائل في المحادثات المعلّقة
        if (conversation.status === 'pending') {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(403).json({
                success: false,
                message: 'لا يمكن إرسال رسالة قبل قبول الطلب',
                code: 'CONVERSATION_PENDING'
            });
        }

        // فحص حظر الكلمات (الرسائل الصوتية لا نفحصها نصياً — لكن نحترم ban)
        if (req.user.bannedWords?.isBanned) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(403).json({
                success: false,
                message: 'تم حظر حسابك بسبب مخالفات متكررة',
                code: 'USER_BANNED'
            });
        }

        const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
        const mediaUrl = `${baseUrl}/uploads/audio/${req.file.filename}`;

        // parse duration + waveform
        const audioDuration = duration ? parseInt(duration, 10) : null;
        let audioWaveform;
        if (waveform) {
            try {
                audioWaveform = typeof waveform === 'string' ? JSON.parse(waveform) : waveform;
                if (!Array.isArray(audioWaveform)) audioWaveform = undefined;
            } catch (e) {
                audioWaveform = undefined;
            }
        }

        const messageData = {
            conversation: conversationId,
            sender: senderId,
            type: 'audio',
            mediaUrl,
            content: '',
            status: 'sent',
            audioDuration,
            audioWaveform
        };

        if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
            messageData.replyTo = replyTo;
        }

        const message = await Message.create(messageData);

        conversation.lastMessage = message._id;
        await conversation.save();

        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name profileImage isPremium verification.isVerified')
            .populate({
                path: 'replyTo',
                select: 'content type sender mediaUrl',
                populate: { path: 'sender', select: 'name' }
            })
            .lean();

        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
        }

        // Push notifications
        const recipients = conversation.participants.filter(
            p => p._id.toString() !== senderId.toString()
        );
        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);
            if (!isOnline && recipient.deviceToken) {
                try {
                    await pushNotificationService.sendNewMessageNotification(
                        recipient._id,
                        req.user.name,
                        '🎤 رسالة صوتية',
                        conversationId,
                        getBestUserImage(req.user),
                        req.user._id
                    );
                } catch (pushErr) {
                    console.error('Push error (audio):', pushErr.message);
                }
            }
        }

        res.json({
            success: true,
            data: {
                message: {
                    _id: populatedMessage._id,
                    conversationId,
                    sender: populatedMessage.sender?._id || senderId,
                    senderUser: populatedMessage.sender,
                    content: populatedMessage.content,
                    type: populatedMessage.type,
                    mediaUrl: populatedMessage.mediaUrl,
                    audioDuration: populatedMessage.audioDuration,
                    audioWaveform: populatedMessage.audioWaveform,
                    replyTo: populatedMessage.replyTo,
                    isRead: false,
                    createdAt: populatedMessage.createdAt,
                    updatedAt: populatedMessage.updatedAt
                }
            }
        });

    } catch (error) {
        console.error('Send audio error:', error);
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        res.status(500).json({
            success: false,
            message: 'حدث خطأ في إرسال الرسالة الصوتية',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/conversations/:conversationId/messages/image
// @desc    إرسال صورة في رسالة (multipart/form-data)
// @access  Private
router.post('/conversations/:conversationId/messages/image', protect, uploadMessageImage.single('image'), async (req, res) => {
    try {
        const { conversationId } = req.params;
        const senderId = req.user._id;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع صورة'
            });
        }

        // فحص حد الصور اليومي (2 للعادي، لا حد للبريميوم)
        if (!req.user.isPremium) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const imageCount = await Message.countDocuments({
                sender: senderId,
                type: 'image',
                createdAt: { $gte: today }
            });
            if (imageCount >= 2) {
                if (req.file) fs.unlinkSync(req.file.path);
                return res.status(429).json({
                    success: false,
                    message: 'وصلت للحد اليومي (2 صور). اشترك في Premium لإرسال بلا حدود',
                    code: 'IMAGE_LIMIT_REACHED',
                    data: { dailyLimit: 2, sent: imageCount }
                });
            }
        }

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email deviceToken');

        if (!conversation) {
            // حذف الصورة المرفوعة
            fs.unlinkSync(req.file.path);
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === senderId.toString()
        );

        if (!isParticipant) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // رابط الصورة
        const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
        const mediaUrl = `${baseUrl}/uploads/messages/${req.file.filename}`;

        // إنشاء الرسالة
        const message = await Message.create({
            conversation: conversationId,
            sender: senderId,
            type: 'image',
            mediaUrl: mediaUrl,
            content: req.body.caption || '',
            status: 'sent'
        });

        // تحديث آخر رسالة في المحادثة
        conversation.lastMessage = message._id;
        await conversation.save();

        // جلب الرسالة مع بيانات المرسل
        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name profileImage isPremium verification.isVerified').lean();

        // إرسال عبر Socket.IO
        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
        }

        // إرسال Push للمستقبلين غير المتصلين
        const recipients = conversation.participants.filter(
            p => p._id.toString() !== senderId.toString()
        );

        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);

            if (!isOnline) {
                await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    '📷 أرسل صورة',
                    conversationId,
                    getBestUserImage(req.user),
                    req.user._id
                );
            }
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال الصورة',
            data: { message: populatedMessage }
        });

    } catch (error) {
        console.error('خطأ في إرسال الصورة:', error);
        // حذف الصورة إذا حدث خطأ
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   POST /api/mobile/conversations/:conversationId/messages
// @desc    إرسال رسالة (route بديل للتوافق مع iOS)
// @access  Private
router.post('/conversations/:conversationId/messages', protect, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { content, type = 'text', mediaUrl, mediaMetadata } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'المحتوى مطلوب'
            });
        }

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId)
            .populate('participants', 'name email deviceToken');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من أن المستخدم جزء من المحادثة
        const isParticipant = conversation.participants.some(
            p => p._id.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // إنشاء الرسالة
        const message = await Message.create({
            conversation: conversationId,
            sender: req.user._id,
            content,
            type,
            mediaUrl: mediaUrl || null,
            mediaMetadata: mediaMetadata || null,
            status: 'sent'
        });

        // تحديث آخر رسالة + عداد الرسائل
        conversation.lastMessage = message._id;
        if (!conversation.metadata) conversation.metadata = {};
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        await conversation.save();

        // جلب الرسالة مع بيانات المرسل
        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name email profileImage isPremium isActive verification.isVerified').lean();

        // إرسال عبر Socket.IO
        console.log('🔥 About to emit new-message to room:', `conversation-${conversationId}`);
        console.log('🔥 global.io exists:', !!global.io);
        if (global.io) {
            global.io.to(`conversation-${conversationId}`).emit('new-message', {
                message: populatedMessage
            });
            console.log('🔥 Emitted!');
        }

        // إرسال إشعارات للمستقبلين الـ offline فقط عبر FCM
        const recipients = conversation.participants.filter(
            p => p._id.toString() !== req.user._id.toString()
        );

        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipientId);

            if (!isOnline) {
                await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    type === 'text' ? (content.length > 100 ? content.substring(0, 100) + '...' : content) : `أرسل ${type === 'image' ? 'صورة' : type === 'audio' ? 'رسالة صوتية' : type === 'video' ? 'فيديو' : 'ملف'}`,
                    conversationId,
                    getBestUserImage(req.user),
                    req.user._id
                );
            }
        }

        res.status(201).json({
            success: true,
            message: 'تم إرسال الرسالة',
            data: { message: populatedMessage }
        });

    } catch (error) {
        console.error('خطأ في إرسال الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// @route   GET /api/mobile/messages/:conversationId
// @desc    الحصول على رسائل محادثة
// @access  Private
router.get('/messages/:conversationId', protect, async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const { conversationId } = req.params;

        // التحقق من المحادثة
        const conversation = await Conversation.findById(conversationId).lean();

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة غير موجودة'
            });
        }

        // التحقق من صلاحية المستخدم
        const isParticipant = conversation.participants.some(
            p => p.toString() === req.user._id.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // ✅ فلترة حسب clearedAt و chatMode
        const messageQuery = { conversation: conversationId };

        // 1) فلترة snap: لا نعرض الرسائل قبل آخر مسح
        const userClear = conversation.clearedAt?.find(
            c => c.user.toString() === req.user._id.toString()
        );
        if (userClear?.date) {
            messageQuery.createdAt = { $gt: userClear.date };
        }

        // 2) فلترة 24h: لا نعرض الرسائل الأقدم من 24 ساعة
        if (conversation.chatMode === '24h') {
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (messageQuery.createdAt) {
                // دمج مع فلتر clearedAt — نأخذ الأحدث
                const clearDate = messageQuery.createdAt.$gt;
                messageQuery.createdAt.$gt = clearDate > cutoff ? clearDate : cutoff;
            } else {
                messageQuery.createdAt = { $gt: cutoff };
            }
        }

        const messages = await Message.find(messageQuery)
            .populate('sender', 'name email profileImage isPremium isActive verification.isVerified')
            .populate({
                path: 'replyTo',
                select: 'content type sender mediaUrl',
                populate: { path: 'sender', select: 'name' }
            })
            .select('+originalContent')   // ✅ Phase 2: نحتاجه لإرجاع النص الأصلي للمرسل
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const total = await Message.countDocuments(messageQuery);

        // إضافة isRead + isDelivered لكل رسالة + sensitive content للمرسل
        const userId = req.user._id.toString();
        const messagesWithReadStatus = messages.reverse().map(msg => {
            const msgObj = { ...msg };
            const isMine = msgObj.sender && msgObj.sender._id && msgObj.sender._id.toString() === userId;

            if (isMine) {
                // رسالتي أنا
                msgObj.isRead = msgObj.status === 'read' ||
                    (msgObj.readBy && msgObj.readBy.some(r => r.user && r.user.toString() !== userId));
                msgObj.isDelivered = msgObj.isRead || msgObj.status === 'delivered';

                // ✅ Phase 2: لو رسالتي محتوى حساس → أرسل النص الأصلي للمرسل (يعرفه أصلاً)
                // الفلاج hasFlaggedContent يبقى true ليعرف iOS أن يعرض شارة "محجوبة من المستلم"
                if (msgObj.hasFlaggedContent && msgObj.originalContent) {
                    msgObj.content = msgObj.originalContent;
                }
            } else {
                // رسالة الطرف الآخر
                msgObj.isRead = true;
                msgObj.isDelivered = true;
            }

            // ✅ لا نرسل originalContent للطرف الآخر أبداً (يحصل عليه فقط عبر /reveal)
            delete msgObj.originalContent;
            return msgObj;
        });

        res.status(200).json({
            success: true,
            data: {
                messages: messagesWithReadStatus,
                total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('خطأ في جلب الرسائل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// ردود الفعل على الرسائل | Message Reactions
// ==========================================

// @route   POST /api/mobile/messages/:messageId/react
// @desc    إضافة/إزالة ردة فعل (toggle)
// @access  Private
router.post('/messages/:messageId/react', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { emoji } = req.body;
        const userId = req.user._id;

        if (!emoji) {
            return res.status(400).json({
                success: false,
                message: 'الإيموجي مطلوب'
            });
        }

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'الرسالة غير موجودة'
            });
        }

        // التحقق من صلاحية المستخدم
        const conversation = await Conversation.findById(message.conversation).lean();
        const isParticipant = conversation && conversation.participants.some(
            p => p.toString() === userId.toString()
        );
        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية'
            });
        }

        // Toggle: إذا نفس الإيموجي من نفس المستخدم → أزله، وإلا أضفه
        const existingIndex = message.reactions.findIndex(
            r => r.user.toString() === userId.toString() && r.emoji === emoji
        );

        if (existingIndex > -1) {
            message.reactions.splice(existingIndex, 1);
        } else {
            // أزل أي reaction قديم من نفس المستخدم (واحد فقط لكل مستخدم)
            message.reactions = message.reactions.filter(
                r => r.user.toString() !== userId.toString()
            );
            message.reactions.push({ user: userId, emoji, createdAt: new Date() });
        }

        await message.save();

        // بث الحدث عبر Socket
        if (global.io) {
            global.io.to(`conversation-${message.conversation}`).emit('message-reaction', {
                messageId: message._id,
                reactions: message.reactions,
                userId: userId.toString(),
                emoji
            });
        }

        res.json({
            success: true,
            message: existingIndex > -1 ? 'تم إزالة ردة الفعل' : 'تم إضافة ردة الفعل',
            data: { reactions: message.reactions }
        });

    } catch (error) {
        console.error('خطأ في ردة الفعل:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// حذف رسالة | Delete Message
// ==========================================

// @route   DELETE /api/mobile/messages/:messageId
// @desc    حذف ناعم لرسالة (المرسل فقط)
// @access  Private
router.delete('/messages/:messageId', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user._id;

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'الرسالة غير موجودة'
            });
        }

        // فقط المرسل يمكنه الحذف
        if (message.sender.toString() !== userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'لا يمكنك حذف رسالة شخص آخر'
            });
        }

        // حذف ناعم
        message.isDeleted = true;
        message.deletedAt = new Date();
        message.content = '';
        message.mediaUrl = '';
        await message.save();

        // بث الحدث عبر Socket
        if (global.io) {
            global.io.to(`conversation-${message.conversation}`).emit('message-deleted', {
                messageId: message._id,
                conversationId: message.conversation
            });
        }

        res.json({
            success: true,
            message: 'تم حذف الرسالة'
        });

    } catch (error) {
        console.error('خطأ في حذف الرسالة:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// إعادة توجيه رسالة | Forward Message
// ==========================================

// @route   POST /api/mobile/messages/forward
// @desc    إعادة توجيه رسالة لمحادثة أخرى
// @access  Private
router.post('/messages/forward', protect, async (req, res) => {
    try {
        const { messageId, targetConversationId } = req.body;
        const userId = req.user._id;

        if (!messageId || !targetConversationId) {
            return res.status(400).json({
                success: false,
                message: 'معرف الرسالة والمحادثة المستهدفة مطلوبان'
            });
        }

        // جلب الرسالة الأصلية
        const originalMessage = await Message.findById(messageId).lean();
        if (!originalMessage || originalMessage.isDeleted) {
            return res.status(404).json({
                success: false,
                message: 'الرسالة غير موجودة'
            });
        }

        // التحقق من المحادثة المستهدفة
        const targetConversation = await Conversation.findById(targetConversationId)
            .populate('participants', 'name email deviceToken');

        if (!targetConversation) {
            return res.status(404).json({
                success: false,
                message: 'المحادثة المستهدفة غير موجودة'
            });
        }

        const isParticipant = targetConversation.participants.some(
            p => p._id.toString() === userId.toString()
        );
        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                message: 'ليس لديك صلاحية لهذه المحادثة'
            });
        }

        // إنشاء الرسالة المُعاد توجيهها
        const forwardedMessage = await Message.create({
            conversation: targetConversationId,
            sender: userId,
            content: originalMessage.content || '',
            type: originalMessage.type,
            mediaUrl: originalMessage.mediaUrl || null,
            status: 'sent'
        });

        // تحديث آخر رسالة
        targetConversation.lastMessage = forwardedMessage._id;
        await targetConversation.save();

        const populatedMessage = await Message.findById(forwardedMessage._id)
            .populate('sender', 'name email profileImage isPremium isActive verification.isVerified').lean();

        // بث عبر Socket
        if (global.io) {
            global.io.to(`conversation-${targetConversationId}`).emit('new-message', {
                message: populatedMessage
            });
        }

        // إشعارات
        const recipients = targetConversation.participants.filter(
            p => p._id.toString() !== userId.toString()
        );
        for (const recipient of recipients) {
            const isOnline = global.connectedUsers && global.connectedUsers.has(recipient._id.toString());
            if (!isOnline) {
                try {
                    await pushNotificationService.sendNewMessageNotification(
                        recipient._id,
                        req.user.name,
                        originalMessage.type === 'image' ? '📷 صورة' : (originalMessage.content || ''),
                        targetConversationId,
                        getBestUserImage(req.user),
                        req.user._id
                    );
                } catch (pushErr) {
                    console.error('Push error:', pushErr.message);
                }
            }
        }

        res.status(201).json({
            success: true,
            message: 'تم إعادة توجيه الرسالة',
            data: { message: populatedMessage }
        });

    } catch (error) {
        console.error('خطأ في إعادة التوجيه:', error);
        res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: error.message
        });
    }
});

// ==========================================
// 📷 مشاهدة صورة مؤقتة | View Disappearing Photo
// ==========================================

// @route   POST /api/mobile/messages/:messageId/view-photo
// @desc    تسجيل مشاهدة صورة مؤقتة وبدء العد التنازلي
// @access  Private
router.post('/messages/:messageId/view-photo', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user._id;

        const message = await Message.findById(messageId);
        if (!message || message.isDeleted) {
            return res.status(404).json({ success: false, message: 'الرسالة غير موجودة' });
        }

        if (!message.disappearing || !message.disappearing.enabled) {
            return res.status(400).json({ success: false, message: 'هذه ليست صورة مؤقتة' });
        }

        // تحقق هل المشاهد مش المرسل
        if (message.sender.toString() === userId.toString()) {
            return res.json({ success: true, message: 'المرسل يقدر يشوف صورته دائماً' });
        }

        // هل شاهدها مسبقاً وانتهت؟
        const existingView = message.disappearing.viewedBy.find(
            v => v.user.toString() === userId.toString()
        );
        if (existingView && existingView.expired) {
            return res.status(410).json({
                success: false,
                message: 'انتهت صلاحية هذه الصورة',
                code: 'PHOTO_EXPIRED'
            });
        }

        // تسجيل المشاهدة لأول مرة
        if (!existingView) {
            message.disappearing.viewedBy.push({
                user: userId,
                viewedAt: new Date(),
                expired: false
            });
            // تعيين وقت الانتهاء
            const duration = message.disappearing.duration || 10;
            message.disappearing.expiresAt = new Date(Date.now() + duration * 1000);
            await message.save();

            // إشعار المرسل بأن الصورة شوهدت
            if (global.io) {
                global.io.to(`user:${message.sender}`).emit('photo-viewed', {
                    messageId: message._id,
                    conversationId: message.conversation,
                    viewedBy: req.user.name,
                    duration: duration
                });
            }
        }

        res.json({
            success: true,
            data: {
                duration: message.disappearing.duration,
                expiresAt: message.disappearing.expiresAt,
                mediaUrl: message.mediaUrl
            }
        });

    } catch (error) {
        console.error('View photo error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// @route   POST /api/mobile/messages/:messageId/expire-photo
// @desc    تأكيد انتهاء صلاحية الصورة بعد انتهاء المؤقت
// @access  Private
router.post('/messages/:messageId/expire-photo', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user._id;

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ success: false, message: 'الرسالة غير موجودة' });
        }

        if (!message.disappearing || !message.disappearing.enabled) {
            return res.status(400).json({ success: false, message: 'هذه ليست صورة مؤقتة' });
        }

        // وضع علامة انتهاء المشاهدة
        const viewEntry = message.disappearing.viewedBy.find(
            v => v.user.toString() === userId.toString()
        );
        if (viewEntry) {
            viewEntry.expired = true;
            await message.save();
        }

        // إشعار المرسل
        if (global.io) {
            global.io.to(`user:${message.sender}`).emit('photo-expired', {
                messageId: message._id,
                conversationId: message.conversation,
                expiredFor: req.user.name
            });
        }

        res.json({ success: true, message: 'تم تأكيد انتهاء الصورة' });

    } catch (error) {
        console.error('Expire photo error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// ==========================================
// 🔒 إشعارات الأمان | Security Alerts
// ==========================================

// @route   POST /api/mobile/messages/:messageId/security-alert
// @desc    تنبيه عند لقطة شاشة أو حفظ صورة
// @access  Private
router.post('/messages/:messageId/security-alert', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { alertType } = req.body; // 'screenshot' | 'screen_record' | 'photo_saved'
        const userId = req.user._id;

        if (!['screenshot', 'screen_record', 'photo_saved'].includes(alertType)) {
            return res.status(400).json({ success: false, message: 'نوع التنبيه غير صالح' });
        }

        const message = await Message.findById(messageId)
            .populate('conversation', 'participants');

        if (!message) {
            return res.status(404).json({ success: false, message: 'الرسالة غير موجودة' });
        }

        // تسجيل التنبيه
        if (!message.securityAlerts) message.securityAlerts = [];
        message.securityAlerts.push({
            type: alertType,
            user: userId,
            createdAt: new Date()
        });
        await message.save();

        // إشعار الطرف الآخر عبر Socket
        const otherParticipants = message.conversation.participants.filter(
            p => p.toString() !== userId.toString()
        );

        const alertEmoji = alertType === 'screenshot' ? '📸' : alertType === 'screen_record' ? '🎥' : '💾';
        const alertTextAr = alertType === 'screenshot' ? 'أخذ لقطة شاشة' :
                           alertType === 'screen_record' ? 'سجّل الشاشة' : 'حفظ الصورة';
        const alertTextEn = alertType === 'screenshot' ? 'took a screenshot' :
                           alertType === 'screen_record' ? 'recorded the screen' : 'saved the photo';

        // ✅ إنشاء رسالة نظام في المحادثة (مثل سناب شات)
        const systemMessage = await Message.create({
            conversation: message.conversation._id,
            sender: userId,
            content: `${alertEmoji} ${req.user.name} ${alertTextAr}`,
            type: 'system'
        });

        // تحديث آخر رسالة في المحادثة
        await Conversation.findByIdAndUpdate(message.conversation._id, {
            lastMessage: systemMessage._id,
            lastMessageAt: new Date()
        });

        if (global.io) {
            for (const participantId of otherParticipants) {
                // تنبيه أمان
                global.io.to(`user:${participantId}`).emit('security-alert', {
                    messageId: message._id,
                    conversationId: message.conversation._id,
                    alertType: alertType,
                    userName: req.user.name,
                    emoji: alertEmoji,
                    textAr: `${req.user.name} ${alertTextAr}`,
                    textEn: `${req.user.name} ${alertTextEn}`
                });

                // رسالة النظام تظهر في المحادثة
                global.io.to(`user:${participantId}`).emit('new-message', {
                    message: systemMessage.toObject(),
                    conversationId: message.conversation._id.toString()
                });
            }
        }

        // Push notification للمستخدم غير المتصل
        for (const participantId of otherParticipants) {
            const isOnline = global.connectedUsers && global.connectedUsers.has(participantId.toString());
            if (!isOnline) {
                try {
                    await pushNotificationService.sendNotificationToUser(participantId, {
                        title: `${alertEmoji} تنبيه أمان`,
                        body: `${req.user.name} ${alertTextAr}`
                    }, {
                        type: 'security_alert',
                        conversationId: message.conversation._id.toString(),
                        alertType: alertType
                    });
                } catch (pushErr) {
                    console.error('Push error:', pushErr.message);
                }
            }
        }

        res.json({ success: true, message: 'تم إرسال التنبيه' });

    } catch (error) {
        console.error('Security alert error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر', error: error.message });
    }
});

// ==========================================
// ✅ Phase 1.3: Sensitive Content Reveal
// ==========================================

// @route   POST /api/v2/mobile/messages/:id/reveal
// @desc    كشف المحتوى الأصلي لرسالة محجوبة (sensitive content)
// @access  Private (المستلم فقط، 18+، setting=ON)
// @returns { content: <originalContent>, revealedAt: Date }
router.post('/messages/:id/reveal', protect, async (req, res) => {
    try {
        const messageId = req.params.id;

        // 1. الـ feature مفعّل من admin؟
        const settings = await require('../../models/Settings').getSettings();
        const sc = settings.sensitiveContent || {};
        if (!sc.featureEnabled) {
            return res.status(403).json({
                success: false,
                message: 'الميزة غير متاحة حالياً',
                code: 'FEATURE_DISABLED'
            });
        }

        // 2. App version >= minClientVersion?
        const clientVersion = req.headers['app-version'] || req.headers['x-app-version'] || null;
        if (!clientSupports(clientVersion, sc.minClientVersion || '6.3')) {
            return res.status(426).json({
                success: false,
                message: 'يجب تحديث التطبيق لاستخدام هذه الميزة',
                code: 'APP_VERSION_TOO_OLD',
                minRequired: sc.minClientVersion || '6.3'
            });
        }

        // 3. المستخدم فعّل الإعداد؟
        const userAllows = req.user.privacySettings?.allowSensitiveContent === true;
        if (!userAllows) {
            return res.status(403).json({
                success: false,
                message: 'الرجاء تفعيل عرض المحتوى الحساس من إعداداتك',
                code: 'USER_SETTING_DISABLED'
            });
        }

        // 4. عمر المستخدم >= minAge؟
        let userAge = null;
        if (req.user.birthDate) {
            const ageMs = Date.now() - new Date(req.user.birthDate).getTime();
            userAge = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000));
        }
        const minAge = sc.minAge || 18;
        if (userAge === null || userAge < minAge) {
            return res.status(403).json({
                success: false,
                message: `هذا الخيار للبالغين فقط (${minAge}+)`,
                code: 'AGE_RESTRICTED'
            });
        }

        // 5. الرسالة موجودة + لها flag + المستخدم طرف فيها (مستلم)
        // نطلب originalContent صراحة لأنه select: false
        const message = await Message.findById(messageId).select('+originalContent conversation sender hasFlaggedContent flaggedCategory');
        if (!message) {
            return res.status(404).json({ success: false, message: 'الرسالة غير موجودة', code: 'NOT_FOUND' });
        }
        if (!message.hasFlaggedContent || !message.originalContent) {
            return res.status(400).json({ success: false, message: 'لا يوجد محتوى للكشف', code: 'NOT_FLAGGED' });
        }
        if (message.sender.toString() === req.user._id.toString()) {
            // المرسل لا يحتاج كشف رسالته الخاصة (يعرفها أصلاً)
            return res.status(400).json({ success: false, message: 'لا يمكنك كشف رسالتك الخاصة', code: 'OWN_MESSAGE' });
        }

        // 6. المستخدم طرف في المحادثة؟
        const conversation = await Conversation.findById(message.conversation).select('participants');
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'المحادثة غير موجودة', code: 'CONVERSATION_NOT_FOUND' });
        }
        const isParticipant = conversation.participants.some(p => p.toString() === req.user._id.toString());
        if (!isParticipant) {
            return res.status(403).json({ success: false, message: 'غير مصرّح', code: 'NOT_PARTICIPANT' });
        }

        // 7. الـ category مشمولة بالإعداد؟ (سياسة)
        const allowedCategories = sc.affectedCategories || ['sexual'];
        if (!allowedCategories.includes(message.flaggedCategory)) {
            return res.status(403).json({
                success: false,
                message: 'هذا النوع من المحتوى لا يمكن كشفه',
                code: 'CATEGORY_NOT_ALLOWED'
            });
        }

        // ✅ كل الفحوصات نجحت — سجّل audit log + أرجع النص الأصلي
        try {
            const SensitiveContentReveal = require('../../models/SensitiveContentReveal');
            await SensitiveContentReveal.create({
                user: req.user._id,
                message: message._id,
                conversation: message.conversation,
                category: message.flaggedCategory,
                userAgeAtReveal: userAge,
                clientVersion,
                ipAddress: req.ip || req.headers['x-forwarded-for'] || null
            });
        } catch (auditErr) {
            console.error('Audit log error (non-fatal):', auditErr.message);
            // لا نفشل الـ request — لكن نسجّل
        }

        return res.json({
            success: true,
            data: {
                messageId: message._id,
                content: message.originalContent,
                category: message.flaggedCategory,
                revealedAt: new Date()
            }
        });

    } catch (error) {
        console.error('Sensitive content reveal error:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

module.exports = router;

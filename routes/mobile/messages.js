const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const User = require('../../models/User');
const Message = require('../../models/Message');
const Conversation = require('../../models/Conversation');
const Notification = require('../../models/Notification');
const Friendship = require('../../models/Friendship');
const FlaggedMessage = require('../../models/FlaggedMessage');
const { protect, adminOnly } = require('../../middleware/auth');
const { spamCheckMiddleware } = require('../../middleware/spamDetection');
const pushNotificationService = require('../../services/pushNotificationService');
const { checkBannedWords } = require('../bannedWords');
const { detectExternalPromotion, recordExternalPromoViolation, isMessagingLockedByPromo, looksLikeExternalHandle } = require('../../utils/externalPromotionDetector');
const { checkMultiMessageNumbers } = require('../../utils/multiMessageNumberDetector');
const { checkMultiMessageLetters, clearLetterBuffer } = require('../../utils/multiMessageLetterDetector');
const { getFullUrl, getBestUserImage, getUserImage, uploadMessageImage, uploadMessageAudio, isUserFullyBanned, blockGuardForConversation, isOtherParticipantDeleted, isUserSocketConnected, markMessageDelivered } = require('./helpers');
const { clientSupports } = require('../../utils/versionCompare');
const Settings = require('../../models/Settings');

// ==========================================
// نظام الرسائل
// ==========================================

// ✅ Helper: أبعاد الصورة المرفوعة — يحجز التطبيق مساحتها قبل التحميل فلا
//    تقفز المحادثة عند وصول كل صورة. الفشل غير حرج: الرسالة تُرسل بلا أبعاد
//    ويستخدم التطبيق نسبته الافتراضية.
async function readImageDimensions(filePath) {
    try {
        const sharp = require('sharp');
        const meta = await sharp(filePath).metadata();
        if (!meta?.width || !meta?.height) return {};
        // orientation 5..8 يعني أن الصورة مدوّرة 90° — الأبعاد المعروضة معكوسة
        const rotated = meta.orientation >= 5 && meta.orientation <= 8;
        return {
            mediaWidth: rotated ? meta.height : meta.width,
            mediaHeight: rotated ? meta.width : meta.height
        };
    } catch (err) {
        console.error('تعذّر قراءة أبعاد الصورة:', err.message);
        return {};
    }
}

// ✅ Helper: فحص قيد المراسلة (يطبَّق على النص + الصور + الصوت)
// يُرجع response object لو مقيّد، أو null لو مسموح
// mediaType: 'text' | 'image' | 'audio' — يُستخدم في رسالة الخطأ فقط
function checkMessagingRestriction(req, mediaType = 'text') {
    if (!req.user.restrictions?.messagingRestricted) return null;
    const now = new Date();
    const until = req.user.restrictions.messagingRestrictedUntil;
    if (until && now >= until) return null; // انتهى التقييد

    const level = req.user.restrictions.messagingRestrictedLevel;
    if (level === 'all') {
        const labels = { text: 'الرسائل', image: 'الصور', audio: 'الرسائل الصوتية' };
        return {
            success: false,
            message: `حسابك مقيّد من إرسال ${labels[mediaType] || 'الرسائل'} مؤقتاً`,
            code: 'MESSAGING_RESTRICTED',
            data: {
                level: 'all',
                until: until?.toISOString(),
                reason: req.user.restrictions.restrictionReason,
                mediaType
            }
        };
    }
    // level === 'new_only': يُسمح فقط في المحادثات القائمة (يُفحص لاحقاً)
    return null;
}

// ✅ نقل ملف صورة مؤقتة منتهية إلى أرشيف الأدمن (لا يُخدَم عبر /uploads).
//    يُرجع المسار النسبي داخل الأرشيف، أو null لو تعذّر.
//    ملاحظة: لا نحذف الملف — الإشراف يحتاجه في البلاغات.
const EXPIRED_DIR = require('path').join(__dirname, '..', '..', 'uploads', '_expired');
function archiveDisappearingFile(mediaUrl) {
    try {
        if (!mediaUrl) return null;
        const path = require('path');
        const fileName = path.basename(String(mediaUrl).split('?')[0]);
        if (!fileName) return null;

        const source = path.join(__dirname, '..', '..', 'uploads', 'messages', fileName);
        if (!fs.existsSync(source)) return null;

        fs.mkdirSync(EXPIRED_DIR, { recursive: true });
        const target = path.join(EXPIRED_DIR, fileName);
        fs.renameSync(source, target);
        return `_expired/${fileName}`;
    } catch (e) {
        // لا نُفشل الطلب — الأهم أن mediaUrl أُبطل في قاعدة البيانات
        console.error('⚠️ أرشفة الصورة المؤقتة فشلت:', e.message);
        return null;
    }
}

// ✅ رسالة جديدة تُعيد إظهار المحادثة لمن حذفها.
//    من يحذف محادثة يُضاف إلى hiddenFor، وقوائم المحادثات تستبعده منها.
//    بلا هذا كانت الرسائل الجديدة تصل إلى محادثة مخفية فلا يراها أبداً —
//    أي أن «حذف المحادثة» كان يعني حجب هذا الشخص إلى الأبد دون قصد.
//    (الرسائل القديمة تبقى مخفية بفضل clearedAt — يبدأ سجلّ نظيف)
async function unhideConversationForRecipients(conversationId, senderId) {
    try {
        // ⚠️ لا تمسّ الإخفاء الناتج عن الحظر (reason: 'block') —
        //    إزالته تُعيد إظهار محادثة أخفاها المستخدم بحظره للطرف الآخر.
        await Conversation.updateOne(
            { _id: conversationId },
            {
                $pull: {
                    hiddenFor: {
                        user: { $ne: senderId },
                        reason: { $ne: 'block' }
                    }
                }
            }
        );
    } catch (e) {
        console.error('⚠️ إعادة إظهار المحادثة فشلت:', e.message);
    }
}

// ✅ تدمير صورة مؤقتة انقضى وقتها — بغضّ النظر عن كون العارض مفتوحاً.
//    المدة تُحسب بساعة الحائط من أول مشاهدة (expiresAt)، فلو أغلق المستخدم
//    العارض مبكراً ثم انقضت المدة وهو خارجها يجب أن تُدمَّر أيضاً.
//    يُستدعى كسلاً عند القراءة/المحاولة — لا يحتاج cron.
//    يُرجع true لو دُمِّرت الآن.
async function destroyDisappearingIfDue(message) {
    const d = message?.disappearing;
    if (!d?.enabled || d.destroyed) return false;
    if (!d.expiresAt || new Date(d.expiresAt) > new Date()) return false;

    const archived = archiveDisappearingFile(message.mediaUrl);
    d.destroyed = true;
    d.destroyedAt = new Date();
    d.archivedPath = archived;
    (d.viewedBy || []).forEach(v => { v.expired = true; });
    message.mediaUrl = null;
    await message.save();

    if (global.io) {
        const payload = {
            messageId: String(message._id),
            conversationId: String(message.conversation),
            destroyed: true
        };
        global.io.to(`user:${message.sender}`).emit('photo-expired', payload);
        global.io.to(`conversation-${message.conversation}`).emit('photo-expired', payload);
    }
    return true;
}

// ✅ Helper موحَّد: بوابة الإرسال في محادثة
// يفحص (بهذا الترتيب): الحظر المتبادل → المحادثة منتهية → غير نشطة → معلّقة (طلب)
// يُرجع { status, body } لو ممنوع، أو null لو مسموح.
// ملاحظة: في حالة pending يُسمح للمنشئ برسالة واحدة فقط حتى يقبل الطرف الآخر
// (مكافحة الإزعاج: إغلاق المحادثة ثم قصفها برسائل "طلب" متتالية).
async function checkConversationSendGate(conversation, user) {
    const userId = String(user._id);

    // 0) الطرف الآخر حذف حسابه — لا وجهة للرسالة أصلاً
    if (await isOtherParticipantDeleted(conversation, userId)) {
        return {
            status: 410,
            body: {
                success: false,
                message: 'تم حذف حساب هذا المستخدم — لا يمكن إرسال رسائل',
                code: 'USER_DELETED'
            }
        };
    }

    // 1) الحظر — بأي اتجاه
    const blockGuard = await blockGuardForConversation(conversation, userId);
    if (blockGuard) return { status: 403, body: blockGuard };

    // 2) محادثة منتهية (أنهاها أحد الطرفين)
    if (conversation.status === 'cancelled') {
        return {
            status: 400,
            body: {
                success: false,
                message: 'انتهت هذه المحادثة. أرسل طلباً جديداً للاستئناف.',
                code: 'CONVERSATION_CANCELLED'
            }
        };
    }

    // 3) غير نشطة / مرفوضة / منتهية الصلاحية
    if (!conversation.isActive || conversation.status === 'rejected' || conversation.status === 'expired') {
        return {
            status: 400,
            body: { success: false, message: 'المحادثة غير نشطة', code: 'CONVERSATION_INACTIVE' }
        };
    }

    // 4) معلّقة — فقط المنشئ يرسل، ورسالة واحدة فقط
    if (conversation.status === 'pending') {
        if (String(conversation.creator) !== userId) {
            return {
                status: 400,
                body: {
                    success: false,
                    message: 'لا يمكنك الإرسال حتى تقبل المحادثة',
                    code: 'CONVERSATION_PENDING'
                }
            };
        }

        const since = conversation.requestedAt || conversation.createdAt || new Date(0);
        const sentInRequest = await Message.countDocuments({
            conversation: conversation._id,
            sender: user._id,
            type: { $ne: 'system' },
            isDeleted: { $ne: true },
            createdAt: { $gte: since }
        });

        if (sentInRequest >= 1) {
            return {
                status: 403,
                body: {
                    success: false,
                    message: 'أرسلت طلبك بالفعل. انتظر رد الطرف الآخر قبل إرسال رسالة أخرى.',
                    code: 'PENDING_REQUEST_LIMIT',
                    data: { allowed: 1, sent: sentInRequest }
                }
            };
        }
    }

    return null;
}

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

        // 🚫 الحظر — لا إرسال بأي اتجاه بين طرفين أحدهما حاظر للآخر
        const blockGuard = await blockGuardForConversation(conversation, req.user._id);
        if (blockGuard) return res.status(403).json(blockGuard);

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

        // 👥 ميزة الأصدقاء: محادثة مفتوحة دائماً —
        // لو المحادثة مغلقة/منتهية/غير نشطة والطرفان صديقان → إعادة فتح تلقائية
        // ⚠️ استثناء: لو أنهى الطرف الآخر المحادثة صراحةً وما زالت التهدئة سارية،
        //    لا إعادة فتح تلقائية — حتى للأصدقاء (منع إزعاج بعد قرار إنهاء صريح).
        const cancelCooldownActive = conversation.status === 'cancelled'
            && conversation.reinviteAllowedAt
            && new Date(conversation.reinviteAllowedAt) > new Date()
            && String(conversation.cancelledBy) !== String(req.user._id);

        if ((['cancelled', 'expired', 'rejected'].includes(conversation.status) || !conversation.isActive)
            && !cancelCooldownActive) {
            const otherParticipant = conversation.participants.find(
                p => p._id.toString() !== req.user._id.toString()
            );
            if (otherParticipant) {
                const friendship = await Friendship.findOne({
                    status: 'accepted',
                    $or: [
                        { requester: req.user._id, recipient: otherParticipant._id },
                        { requester: otherParticipant._id, recipient: req.user._id }
                    ]
                }).select('_id').lean();
                if (friendship) {
                    conversation.status = 'accepted';
                    conversation.isActive = true;
                    await conversation.save();
                }
            }
        }

        // ✅ بوابة الإرسال الموحَّدة: منتهية / غير نشطة / معلّقة (رسالة واحدة للمنشئ)
        const sendGate = await checkConversationSendGate(conversation, req.user);
        if (sendGate) return res.status(sendGate.status).json(sendGate.body);

        // ✅ Phase 2: لو messaging مقفول بسبب external promo violations → أبلغ المرسل بـ dialog (201)
        if (isMessagingLockedByPromo(req.user)) {
            const lockedUntil = req.user.restrictions.messagingRestrictedUntil;
            const hoursLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 60 * 1000));
            return res.status(201).json({
                success: true,
                data: { message: null },
                messagingLocked: {
                    title: 'المراسلة مقيّدة مؤقتاً',
                    message: `تم تقييد مراسلتك لمدة ${hoursLeft} ساعة بسبب محاولات متكررة لمشاركة حسابات خارجية`,
                    serverMessage: `لحماية مجتمع هلا، يتم تقييد المراسلة عند تجاوز الحد المسموح من المخالفات. ستتمكن من الإرسال مجدداً خلال ${hoursLeft} ساعة.`,
                    hoursLeft,
                    lockedUntil: lockedUntil?.toISOString(),
                    code: 'MESSAGING_LOCKED_PROMO'
                }
            });
        }

        // ⚠️ رسالة الموقع تُرسل كنص بالصيغة: "📍 lat,lng|العنوان"
        //    الإحداثيات وحدها 12+ رقماً، فكان \b\d{6,15}\b يعتبرها رقم هاتف:
        //    الرسالة تُطمَس إلى *** وتُسجَّل مخالفة ترويج خارجي على المُرسِل
        //    (وتتراكم حتى تقييد المراسلة). نفحص العنوان فقط — يبقى تهريب
        //    الحسابات داخل العنوان مكشوفاً بينما لا تُدان الإحداثيات.
        const locationPrefixMatch = (type === 'text' && typeof content === 'string')
            ? content.trim().match(/^📍\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\|/)
            : null;
        const locationPrefix = locationPrefixMatch ? locationPrefixMatch[0] : '';
        const filterText = locationPrefix
            ? content.trim().slice(locationPrefix.length)
            : content;

        // فحص الكلمات المحظورة + الترويج الخارجي (Snap/Insta/...)
        let censoredContent = content;
        let bannedResult = { hasBannedWords: false, matchedWords: [], categories: [] };
        let externalPromoDetected = false;
        let externalPromoCategories = [];
        let externalPromoViolation = null;
        let promo = { detected: false, redacted: content, categories: [], patterns: [] };
        if (type === 'text' && filterText) {
            // 1. ترويج خارجي — يُفحَص أولاً على النص الأصلي (قبل أي censoring)
            //    أولوية على banned words لأن الحسابات الخارجية تحتاج violation tracking منفصل
            //    ولا نريد أن يطمسها banned-words filter قبل أن يلتقطها الـ detector
            promo = detectExternalPromotion(filterText);
            const originalContent = content;
            if (promo.detected) {
                censoredContent = locationPrefix + promo.redacted;
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
                bannedResult = await checkBannedWords(filterText);
                if (bannedResult.hasBannedWords) {
                    censoredContent = locationPrefix + bannedResult.censoredText;

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
                    filterText
                );
                if (multiNum.detected) {
                    censoredContent = locationPrefix + '***';
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
            originalContent: sensitiveFlag.originalContent,
            isExternalPromoBlocked: false,   // يُحدَّث لاحقاً لو اكتُشف
            externalPromoCategories: []
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
                filterText,
                message._id.toString()
            );

            if (multiLetterDetection.detected) {
                // 1. حدّث كل الرسائل المعنية (الحالية + السابقة) → ***
                // ✅ نحفظ originalContent لكل رسالة على حدة حتى يُمكن كشفها لو
                //    فعّل المستلم 'عرض المحتوى الحساس' (نفس آلية sensitive content)
                const idsToFlag = multiLetterDetection.bufferedMessageIds || [];
                if (idsToFlag.length > 0) {
                    // جلب الرسائل المعنية لاحتفاظ بمحتواها الأصلي قبل التغطية
                    const originals = await Message.find({ _id: { $in: idsToFlag } })
                        .select('_id content originalContent')
                        .lean();

                    // bulkWrite لتحديث كل رسالة بمحتواها الأصلي الخاص
                    const bulkOps = originals.map(orig => ({
                        updateOne: {
                            filter: { _id: orig._id },
                            update: {
                                $set: {
                                    content: '***',
                                    hasFlaggedContent: true,
                                    flaggedCategory: 'external_promo_split',
                                    isExternalPromoBlocked: true,
                                    externalPromoCategories: ['external_promo_split'],
                                    // احفظ originalContent فقط لو لم يكن محفوظاً سابقاً
                                    ...(orig.originalContent ? {} : { originalContent: orig.content })
                                }
                            }
                        }
                    }));
                    await Message.bulkWrite(bulkOps);

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

            // ✅ رفع المستخدم الجديد المعلّق إلى flagged عند المخالفة (يُخفى للمراجعة)
            const { flagPendingNewcomer } = require('../../utils/newcomerReview');
            await flagPendingNewcomer(req.user._id, 'كلمات محظورة أثناء فترة مراجعة الحساب الجديد');

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
        await unhideConversationForRecipients(conversation._id, req.user._id);
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
            const isOnline = await isUserSocketConnected(recipientId);

            if (!isOnline) {
                // إرسال Push Notification عبر Firebase للـ offline users فقط
                await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    type === 'text' ? (content.length > 100 ? content.substring(0, 100) + '...' : content) : `أرسل ${type === 'image' ? 'صورة' : type === 'audio' ? 'رسالة صوتية' : type === 'video' ? 'فيديو' : 'ملف'}`,
                    conversationId,
                    getBestUserImage(req.user),
                    req.user._id,
                    message._id
                );
            } else {
                // ✅ المستلم متصل بالسوكِت → الرسالة وصلت جهازه عبر user:room فوراً.
                //    لا ننتظر تأكيد العميل (message-delivered) — قد يضيع لو كان
                //    التطبيق في انتقال حالة، فتبقى ✓ واحدة رغم وصولها.
                await markMessageDelivered(message._id, conversationId, req.user._id);
                // ✅ وأعِدها في ردّ HTTP أيضاً — حدث السوكِت يسبق ردّ الإرسال،
                //    فالمرسل ما زال يحمل معرّفاً مؤقتاً ولا يجد الرسالة ليحدّثها.
                senderMessage.status = 'delivered';
                senderMessage.isDelivered = true;
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

        // ✅ تحديث حقل isExternalPromoBlocked على الرسالة
        if (externalPromoDetected) {
            await Message.findByIdAndUpdate(message._id, {
                isExternalPromoBlocked: true,
                externalPromoCategories: externalPromoCategories
            });
            if (senderMessage) {
                senderMessage.isExternalPromoBlocked = true;
                senderMessage.externalPromoCategories = externalPromoCategories;
            }
        }

        // ✅ تحذير عند اكتشاف ترويج خارجي (Snap/Insta/...) — sheet احترافي على iOS
        if (externalPromoDetected) {
            const v = externalPromoViolation?.violations || 0;
            const t = externalPromoViolation?.threshold || 5;
            const lockCount = externalPromoViolation?.lockCount || 0;
            const durationHours = externalPromoViolation?.durationHours || 0;

            // أنماط مُقنَّعة
            const allPatterns = [
                ...(promo.patterns || []),
                ...(bannedResult.matchedWords || [])
            ];
            const maskedPatterns = allPatterns.map(p => {
                const w = (p.matched || p || '').toString();
                if (w.length <= 2) return '*'.repeat(w.length);
                return w[0] + '*'.repeat(Math.max(w.length - 2, 1)) + w[w.length - 1];
            });
            const detectedPatterns = [...new Set(maskedPatterns)].filter(Boolean).slice(0, 5);

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
                suspended: externalPromoViolation?.suspended || false,
                // ✅ الكلمات المكتشفة مع إخفاء جزئي
                detectedPatterns
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

// @route   POST /api/mobile/messages/:id/appeal-block
// @desc    استئناف حجب رسالة خارجية
// @access  Private
router.post('/messages/:id/appeal-block', protect, async (req, res) => {
    try {
        const { reason } = req.body;
        const message = await Message.findById(req.params.id);
        if (!message?.isExternalPromoBlocked) {
            return res.status(400).json({ success: false, message: 'لا يوجد حجب لهذه الرسالة' });
        }
        if (message.sender.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: 'غير مصرّح' });
        }
        await Message.findByIdAndUpdate(req.params.id, {
            appealStatus: 'pending',
            appealReason: reason || 'no_reason',
            appealedAt: new Date()
        });
        res.json({ success: true, message: 'تم تقديم الاستئناف، سيتم مراجعته خلال 24 ساعة' });
    } catch (error) {
        console.error('خطأ في استئناف الحجب:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

// @route   POST /api/mobile/messages/send-image
// @desc    إرسال صورة — يستقبل conversationId من body (للتوافق مع تطبيق iOS)
// @access  Private
router.post('/messages/send-image', protect, uploadMessageImage.single('image'), async (req, res) => {
    // ✅ فحص تقييد المراسلة قبل أي شيء (ثغرة سابقة: كان يسمح بالصور للمقيدين)
    const restriction = checkMessagingRestriction(req, 'image');
    if (restriction) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(403).json(restriction);
    }

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

        // فحص حد الصور اليومي (6 للعادي، لا حد للبريميوم)
        if (!req.user.isPremium) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const imageCount = await Message.countDocuments({
                sender: senderId,
                type: 'image',
                createdAt: { $gte: today }
            });
            if (imageCount >= 6) {
                if (req.file) fs.unlinkSync(req.file.path);
                return res.status(429).json({
                    success: false,
                    message: 'وصلت للحد اليومي (6 صور). اشترك في Premium لإرسال بلا حدود',
                    code: 'IMAGE_LIMIT_REACHED',
                    data: { dailyLimit: 6, sent: imageCount }
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

        // ✅ بوابة الإرسال (حظر / منتهية / معلّقة)
        const gateImg = await checkConversationSendGate(conversation, req.user);
        if (gateImg) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(gateImg.status).json(gateImg.body);
        }

        const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
        const mediaUrl = `${baseUrl}/uploads/messages/${req.file.filename}`;

        // ✅ بيانات الصورة المؤقتة ومصدرها
        const imageSource = req.body.imageSource || null; // 'camera' | 'gallery'
        const disappearingDuration = req.body.disappearingDuration ? parseInt(req.body.disappearingDuration) : null; // ثواني

        const dimensions = await readImageDimensions(req.file.path);

        const messageData = {
            conversation: conversationId,
            sender: senderId,
            type: 'image',
            mediaUrl: mediaUrl,
            content: req.body.caption || '',
            status: 'sent',
            ...dimensions
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

        await unhideConversationForRecipients(conversation._id, req.user._id);
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

        let deliveredNow = false;
        for (const recipient of recipients) {
            const recipientId = recipient._id.toString();
            const isOnline = await isUserSocketConnected(recipientId);

            if (!isOnline && recipient.deviceToken) {
                try {
                    await pushNotificationService.sendNewMessageNotification(
                        recipient._id || recipient,
                        req.user.name || req.user,
                        disappearingDuration ? '📷 صورة مؤقتة' : '📷 صورة',
                        conversationId,
                        getBestUserImage(req.user),
                        req.user._id,
                        message._id
                    );
                } catch (pushErr) {
                    console.error('Push error:', pushErr.message);
                }
            } else if (isOnline) {
                deliveredNow = await markMessageDelivered(message._id, conversationId, req.user._id) || deliveredNow;
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
                    mediaWidth: populatedMessage.mediaWidth,
                    mediaHeight: populatedMessage.mediaHeight,
                    imageSource: populatedMessage.imageSource,
                    disappearing: populatedMessage.disappearing,
                    isDelivered: deliveredNow,
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

        // ✅ فحص تقييد المراسلة (موحَّد عبر helper — يدعم رسالة مخصصة للصوت)
        const restrictionAudio = checkMessagingRestriction(req, 'audio');
        if (restrictionAudio) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(403).json(restrictionAudio);
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

        // ✅ بوابة الإرسال (حظر / منتهية / معلّقة)
        const gateAudio = await checkConversationSendGate(conversation, req.user);
        if (gateAudio) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(gateAudio.status).json(gateAudio.body);
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

        await unhideConversationForRecipients(conversation._id, req.user._id);
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
            const isOnline = await isUserSocketConnected(recipientId);
            if (!isOnline && recipient.deviceToken) {
                try {
                    await pushNotificationService.sendNewMessageNotification(
                        recipient._id,
                        req.user.name,
                        '🎤 رسالة صوتية',
                        conversationId,
                        getBestUserImage(req.user),
                        req.user._id,
                        message._id
                    );
                } catch (pushErr) {
                    console.error('Push error (audio):', pushErr.message);
                }
            } else if (isOnline) {
                if (await markMessageDelivered(message._id, conversationId, req.user._id)) {
                    populatedMessage.isDelivered = true;
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

        // ✅ فحص تقييد المراسلة (ثغرة سابقة)
        const restriction = checkMessagingRestriction(req, 'image');
        if (restriction) {
            if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
            return res.status(403).json(restriction);
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'لم يتم رفع صورة'
            });
        }

        // فحص حد الصور اليومي (6 للعادي، لا حد للبريميوم)
        if (!req.user.isPremium) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const imageCount = await Message.countDocuments({
                sender: senderId,
                type: 'image',
                createdAt: { $gte: today }
            });
            if (imageCount >= 6) {
                if (req.file) fs.unlinkSync(req.file.path);
                return res.status(429).json({
                    success: false,
                    message: 'وصلت للحد اليومي (6 صور). اشترك في Premium لإرسال بلا حدود',
                    code: 'IMAGE_LIMIT_REACHED',
                    data: { dailyLimit: 6, sent: imageCount }
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

        // ✅ بوابة الإرسال (حظر / منتهية / معلّقة) — كانت ناقصة في هذا المسار
        const gateAltImg = await checkConversationSendGate(conversation, req.user);
        if (gateAltImg) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            return res.status(gateAltImg.status).json(gateAltImg.body);
        }

        // رابط الصورة
        const baseUrl = process.env.BASE_URL || 'https://matchhala.chathala.com';
        const mediaUrl = `${baseUrl}/uploads/messages/${req.file.filename}`;

        // إنشاء الرسالة
        const dimensionsAlt = await readImageDimensions(req.file.path);
        const message = await Message.create({
            conversation: conversationId,
            sender: senderId,
            type: 'image',
            mediaUrl: mediaUrl,
            content: req.body.caption || '',
            status: 'sent',
            ...dimensionsAlt
        });

        // تحديث آخر رسالة في المحادثة
        await unhideConversationForRecipients(conversation._id, req.user._id);
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
            const isOnline = await isUserSocketConnected(recipientId);

            if (!isOnline) {
                await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    '📷 أرسل صورة',
                    conversationId,
                    getBestUserImage(req.user),
                    req.user._id,
                    message._id
                );
            } else {
                if (await markMessageDelivered(message._id, conversationId, req.user._id)) {
                    populatedMessage.isDelivered = true;
                }
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

        // ✅ فحص تقييد المراسلة (ثغرة سابقة في الـ alt route)
        const restrictionAlt = checkMessagingRestriction(req, type === 'image' ? 'image' : type === 'audio' ? 'audio' : 'text');
        if (restrictionAlt) return res.status(403).json(restrictionAlt);

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

        // ✅ بوابة الإرسال (حظر / منتهية / معلّقة) — كانت ناقصة في هذا المسار
        const gateAlt = await checkConversationSendGate(conversation, req.user);
        if (gateAlt) return res.status(gateAlt.status).json(gateAlt.body);

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
        await unhideConversationForRecipients(conversation._id, req.user._id);
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
            const isOnline = await isUserSocketConnected(recipientId);

            if (!isOnline) {
                await pushNotificationService.sendNewMessageNotification(
                    recipient._id,
                    req.user.name,
                    type === 'text' ? (content.length > 100 ? content.substring(0, 100) + '...' : content) : `أرسل ${type === 'image' ? 'صورة' : type === 'audio' ? 'رسالة صوتية' : type === 'video' ? 'فيديو' : 'ملف'}`,
                    conversationId,
                    getBestUserImage(req.user),
                    req.user._id,
                    message._id
                );
            } else {
                if (await markMessageDelivered(message._id, conversationId, req.user._id)) {
                    populatedMessage.isDelivered = true;
                }
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

        // 2) فلترة 24h: تختفي الرسائل القديمة فقط بعد قراءتها
        //    الرسائل غير المقروءة تظل ظاهرة بغض النظر عن العمر —
        //    وإلا المستخدم الذي يدخل بعد > 24 ساعة يفقد رسائل لم يقرأها أصلاً.
        if (conversation.chatMode === '24h') {
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const userObjectId = new mongoose.Types.ObjectId(req.user._id);
            // قد يكون messageQuery.createdAt مضبوط من فلتر clearedAt — نتركه كما هو (top-level AND)
            messageQuery.$or = [
                { createdAt: { $gt: cutoff } },           // حديثة (< 24h)
                { sender: userObjectId },                  // رسائلي أنا — أحتفظ بها دائماً
                { 'readBy.user': { $ne: userObjectId } }   // لم أقرأها بعد — تبقى ظاهرة
            ];
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

        // ✅ افرض انقضاء الصور المؤقتة قبل بناء الرد — تدمير كسول لا يحتاج cron.
        //    بدونه تبقى الصورة ظاهرة للطرفين إلى الأبد لو أُغلق العارض مبكراً.
        try {
            const dueIds = messages
                .filter(m => m.disappearing?.enabled
                    && !m.disappearing.destroyed
                    && m.disappearing.expiresAt
                    && new Date(m.disappearing.expiresAt) <= new Date())
                .map(m => m._id);

            for (const id of dueIds) {
                const doc = await Message.findById(id);
                if (doc && await destroyDisappearingIfDue(doc)) {
                    const idx = messages.findIndex(m => String(m._id) === String(id));
                    if (idx >= 0) {
                        messages[idx].mediaUrl = null;
                        messages[idx].disappearing = {
                            ...messages[idx].disappearing,
                            destroyed: true
                        };
                    }
                }
            }
        } catch (dueErr) {
            console.error('⚠️ فرض انقضاء الصور المؤقتة فشل:', dueErr.message);
        }

        // ✅ فتح المحادثة = استلام فعلي لرسائل الطرف الآخر.
        //    بدون هذا، الرسائل التي وصلت والتطبيق مغلق تبقى «مُرسَلة» للأبد،
        //    لأن تأكيد الاستلام يُرسَل فقط من حدث السوكِت اللحظي.
        try {
            const incomingSent = messages
                .filter(m => m.status === 'sent'
                    && m.sender && String(m.sender._id || m.sender) !== String(req.user._id))
                .map(m => m._id);

            if (incomingSent.length > 0) {
                await Message.updateMany(
                    { _id: { $in: incomingSent }, status: 'sent' },
                    { $set: { status: 'delivered' } }
                );

                // أبلغ كل مُرسِل على غرفته الخاصة + غرفة المحادثة (تحديث فوري للسهم)
                if (global.io) {
                    for (const m of messages) {
                        if (!incomingSent.some(id => String(id) === String(m._id))) continue;
                        const payload = {
                            messageId: String(m._id),
                            conversationId: String(conversationId)
                        };
                        global.io.to(`user:${String(m.sender._id || m.sender)}`)
                            .emit('message-delivered', payload);
                        global.io.to(`conversation-${conversationId}`)
                            .emit('message-delivered', payload);
                    }
                }
                // اعكس الحالة في الرد الحالي بدل انتظار جلب آخر
                messages.forEach(m => {
                    if (incomingSent.some(id => String(id) === String(m._id))) m.status = 'delivered';
                });
            }
        } catch (deliverErr) {
            console.error('⚠️ تعليم الرسائل كمُستلَمة فشل:', deliverErr.message);
        }

        // إضافة isRead + isDelivered لكل رسالة + sensitive content للمرسل
        const userId = req.user._id.toString();
        const messagesWithReadStatus = messages.reverse().map(msg => {
            const msgObj = { ...msg };
            const isMine = msgObj.sender && msgObj.sender._id && msgObj.sender._id.toString() === userId;

            // ✅ صورة مؤقتة انتهت لهذا المستخدم → لا يُعاد الرابط إطلاقاً
            //    (كان بإمكانه استرجاعها بمجرد إعادة جلب الرسائل)
            if (msgObj.disappearing?.enabled && !isMine) {
                const myView = (msgObj.disappearing.viewedBy || []).find(
                    v => String(v.user) === userId
                );
                if (msgObj.disappearing.destroyed || myView?.expired) {
                    msgObj.mediaUrl = null;
                    msgObj.disappearing = {
                        ...msgObj.disappearing,
                        archivedPath: undefined,   // لا نكشف مسار الأرشيف للعميل
                        isExpiredForMe: true
                    };
                }
            }

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

        // ✅ حالة تقييد المراسلة بسبب نشر حسابات خارجية — لعرض بانر أعلى المحادثة
        let messagingRestriction = null;
        if (isMessagingLockedByPromo(req.user)) {
            const lockedUntil = req.user.restrictions.messagingRestrictedUntil;
            const hoursLeft = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / (60 * 60 * 1000)));
            messagingRestriction = {
                restricted: true,
                reason: 'external_promotion',
                title: 'حسابك مقيّد مؤقتاً',
                message: `تم تقييد المراسلة بسبب تكرار نشر حسابات خارجية. يتبقّى ${hoursLeft} ساعة.`,
                hoursLeft,
                lockedUntil: lockedUntil.toISOString()
            };
        }

        res.status(200).json({
            success: true,
            data: {
                messages: messagesWithReadStatus,
                total,
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                messagingRestriction
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
        // ⚠️ لا تستخدم save(): تفريغ content على رسالة type='text' يفشل
        //    التحقق (content مطلوب للنصوص) فيرجع 500 ولا تُحذف الرسالة إطلاقاً.
        //    كان يملأ سجلّ الإنتاج بـ ValidationError. updateOne يتخطّى
        //    التحقق على المستند ويطبّق الحذف فعلاً.
        await Message.updateOne(
            { _id: message._id },
            { $set: { isDeleted: true, deletedAt: new Date(), content: '', mediaUrl: '' } }
        );

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
// تعديل رسالة | Edit Message
// ==========================================

// نافذة التعديل: 15 دقيقة من الإرسال
const EDIT_WINDOW_MS = 15 * 60 * 1000;

// @route   PUT /api/mobile/messages/:messageId
// @desc    تعديل نصّ رسالة (المرسل فقط، نصّية فقط، خلال 15 دقيقة) — ميزة بريميوم
// @access  Private (Premium)
router.put('/messages/:messageId', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user._id;
        const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';

        if (!req.user.isPremium) {
            return res.status(403).json({
                success: false,
                message: 'تعديل الرسائل متاح للمشتركين فقط',
                code: 'PREMIUM_REQUIRED'
            });
        }

        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'نصّ الرسالة مطلوب',
                code: 'EMPTY_CONTENT'
            });
        }

        const message = await Message.findById(messageId);
        if (!message) {
            return res.status(404).json({ success: false, message: 'الرسالة غير موجودة' });
        }

        if (message.sender.toString() !== userId.toString()) {
            return res.status(403).json({
                success: false,
                message: 'لا يمكنك تعديل رسالة شخص آخر',
                code: 'NOT_SENDER'
            });
        }

        if (message.isDeleted) {
            return res.status(400).json({
                success: false,
                message: 'الرسالة محذوفة',
                code: 'MESSAGE_DELETED'
            });
        }

        if (message.type !== 'text') {
            return res.status(400).json({
                success: false,
                message: 'يمكن تعديل الرسائل النصّية فقط',
                code: 'NOT_TEXT_MESSAGE'
            });
        }

        if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
            return res.status(400).json({
                success: false,
                message: 'انتهت مهلة تعديل هذه الرسالة (15 دقيقة)',
                code: 'EDIT_WINDOW_EXPIRED'
            });
        }

        // ⚠️ التعديل يمرّ بنفس فلاتر الإرسال — وإلا صار ثغرة لتجاوزها
        //    (أرسل نصّاً بريئاً ثم عدّله إلى حساب خارجي).
        const promo = detectExternalPromotion(content);
        if (promo.detected) {
            await recordExternalPromoViolation(req.user, {
                source: 'message_edit',
                categories: promo.categories,
                patterns: promo.patterns,
                conversationId: message.conversation,
                originalText: content
            });
            return res.status(403).json({
                success: false,
                message: 'تم حجب التعديل — لا يمكن مشاركة حسابات خارجية',
                code: 'EXTERNAL_PROMO_BLOCKED',
                externalPromoBlocked: { categories: promo.categories }
            });
        }

        const bannedResult = await checkBannedWords(content);
        const finalContent = bannedResult.hasBannedWords ? bannedResult.censoredText : content;

        const editedAt = new Date();
        await Message.updateOne(
            { _id: message._id },
            { $set: { content: finalContent, isEdited: true, editedAt } }
        );

        const payload = {
            messageId: String(message._id),
            conversationId: String(message.conversation),
            content: finalContent,
            isEdited: true,
            editedAt: editedAt.toISOString()
        };

        if (global.io) {
            global.io.to(`conversation-${message.conversation}`).emit('message-edited', payload);
            // غرف المستخدمين أيضاً — الطرف الآخر قد لا يكون داخل المحادثة الآن
            const conv = await Conversation.findById(message.conversation).select('participants').lean();
            (conv?.participants || []).forEach(p => {
                global.io.to(`user:${p}`).emit('message-edited', payload);
            });
        }

        res.json({
            success: true,
            message: 'تم تعديل الرسالة',
            data: payload
        });

    } catch (error) {
        console.error('خطأ في تعديل الرسالة:', error);
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
        // ✅ فحص تقييد المراسلة (forward = إرسال — ثغرة سابقة)
        const restrictionFwd = checkMessagingRestriction(req, 'text');
        if (restrictionFwd) return res.status(403).json(restrictionFwd);

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

        // ✅ بوابة الإرسال في المحادثة المستهدفة (حظر / منتهية / معلّقة)
        const gateFwd = await checkConversationSendGate(targetConversation, req.user);
        if (gateFwd) return res.status(gateFwd.status).json(gateFwd.body);

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
            const isOnline = await isUserSocketConnected(recipient._id);
            if (!isOnline) {
                try {
                    await pushNotificationService.sendNewMessageNotification(
                        recipient._id,
                        req.user.name,
                        originalMessage.type === 'image' ? '📷 صورة' : (originalMessage.content || ''),
                        targetConversationId,
                        getBestUserImage(req.user),
                        req.user._id,
                        forwardedMessage._id
                    );
                } catch (pushErr) {
                    console.error('Push error:', pushErr.message);
                }
            } else {
                if (await markMessageDelivered(forwardedMessage._id, targetConversationId, req.user._id)) {
                    populatedMessage.isDelivered = true;
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

        // ✅ انقضى وقتها وهو خارج العارض → دمّرها الآن بدل فتحها
        if (await destroyDisappearingIfDue(message)) {
            return res.status(410).json({
                success: false,
                message: 'انتهت مدة الصورة المؤقتة',
                code: 'PHOTO_EXPIRED'
            });
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
// @route   GET /api/mobile/admin/expired-photo/:messageId
// @desc    عرض صورة مؤقتة منتهية — للإشراف فقط (الملف خارج /uploads)
// @access  Admin
router.get('/admin/expired-photo/:messageId', protect, adminOnly, async (req, res) => {
    try {
        const message = await Message.findById(req.params.messageId)
            .select('disappearing').lean();

        const archived = message?.disappearing?.archivedPath;
        if (!archived) {
            return res.status(404).json({ success: false, message: 'لا يوجد أرشيف لهذه الصورة' });
        }

        const path = require('path');
        // حماية من path traversal — نأخذ اسم الملف فقط
        const filePath = path.join(EXPIRED_DIR, path.basename(archived));
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'الملف غير موجود في الأرشيف' });
        }

        return res.sendFile(filePath);
    } catch (error) {
        console.error('خطأ في جلب صورة الأرشيف:', error);
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
});

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
        }

        // ✅ تدمير فوري: أبطل الرابط وانقل الملف لأرشيف الأدمن.
        //    الشرط: كل المستلمين (غير المرسل) أنهوا المشاهدة.
        //    الملف يبقى للإشراف لكن لا يُخدَم عبر /uploads إطلاقاً.
        if (!message.disappearing.destroyed) {
            const conv = await Conversation.findById(message.conversation)
                .select('participants').lean();
            const recipients = (conv?.participants || [])
                .map(String)
                .filter(id => id !== String(message.sender));

            const allExpired = recipients.length > 0 && recipients.every(rid =>
                message.disappearing.viewedBy.some(
                    v => String(v.user) === rid && v.expired
                )
            );

            if (allExpired) {
                const archived = archiveDisappearingFile(message.mediaUrl);
                message.disappearing.destroyed = true;
                message.disappearing.destroyedAt = new Date();
                message.disappearing.archivedPath = archived;
                message.mediaUrl = null;   // ✅ الرابط لم يعد صالحاً لأحد
            }
        }

        await message.save();

        // إشعار المرسل
        if (global.io) {
            global.io.to(`user:${message.sender}`).emit('photo-expired', {
                messageId: message._id,
                conversationId: message.conversation,
                expiredFor: req.user.name,
                destroyed: message.disappearing.destroyed === true
            });
        }

        res.json({
            success: true,
            message: 'تم تأكيد انتهاء الصورة',
            data: { destroyed: message.disappearing.destroyed === true }
        });

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
            const isOnline = await isUserSocketConnected(participantId);
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

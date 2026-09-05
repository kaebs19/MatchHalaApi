import React, { useState, useEffect } from 'react';
import { userBioAction,
    editUserBio,
    getUserActivity,
    suspendUser,
    unsuspendUser,
    setUserViolations,
    userNameAction,
    deleteUserPhoto,
    uploadUserProfileImage,
    resetUserChangeLimits,
    sendUserNotification,
    restrictUser,
    getUserReportsCount,
    getUserViolations,
    getRelatedAccounts,
    getWarningTemplates,
    getUserWarnings,
    sendOfficialWarning,
    dismissWarning,
    fetchViolationEvidenceBlob,
    deleteAllUserConversations,
    deleteUserMessage,
    censorUserMessages,
    getUserNameHistory,
    hideUser,
    unhideUser,
    clearUserReports,
    getUserReports,
    getUserPhotoHistory,
    fetchPhotoHistoryBlob
} from '../services/api';
import { useToast } from '../components/Toast';
import { getImageUrl, getDefaultAvatar, getMessagePhotoUrl } from '../config';
import { formatDateTimeLong, formatDateLong } from '../utils/formatters';
import {
    gpsCoords, ipCoords, mapsUrl, formatCoords, placeText, distanceKm, MISMATCH_KM
} from '../utils/location';
import ConversationDetail from './ConversationDetail';
import ConversationMessages from './ConversationMessages';
import './UserDetail.css';

const PHOTO_HISTORY_REASONS = {
    user_replaced: '🔄 استبدلها بنفسه',
    user_deleted: '🗑️ حذفها بنفسه',
    admin_removed: '🛡️ أزالتها الإدارة',
    system: '⚙️ النظام'
};

const REPORT_CATEGORIES = {
    spam: '📢 سبام',
    harassment: '😡 مضايقة',
    inappropriate_content: '🔞 محتوى غير لائق',
    inappropriate: '🔞 غير لائق',
    fake_profile: '🎭 حساب مزيّف',
    hate_speech: '🗣️ خطاب كراهية',
    violence: '⚔️ عنف',
    fraud: '💰 احتيال',
    impersonation: '🎭 انتحال شخصية',
    other: '📌 أخرى'
};

const REPORT_STATUSES = {
    pending: '⏳ معلّق',
    reviewing: '🔍 قيد المراجعة',
    resolved: '✅ مقبول',
    rejected: '❌ مرفوض',
    cancelled: '🚫 ملغى'
};

const REPORT_ACTIONS = {
    warning: '⚠️ تحذير',
    message_deleted: '🗑️ حذف رسالة',
    user_suspended: '⛔ إيقاف',
    user_banned: '🚫 حظر',
    conversation_locked: '🔒 قفل محادثة'
};

function UserDetail({ userId, onBack, onNavigateToUser, onViewConversation }) {
    const [loading, setLoading] = useState(true);
    const [userData, setUserData] = useState(null);
    const [activeTab, setActiveTab] = useState('info');
    const [viewingConversationId, setViewingConversationId] = useState(null);
    const [viewingConversationMessages, setViewingConversationMessages] = useState(false);
    const { showToast } = useToast();

    // External Promo violations history
    const [promoLogs, setPromoLogs] = useState(null);

    // ✅ إخفاء الحساب (Modal) — الافتراضي 24h + رسائل سريعة
    const HIDE_QUICK_REASONS = [
        '🚫 اسم مخالف',
        '📷 صورة مخالفة',
        '📝 نبذة مخالفة',
        '⚠️ مخالفات متعددة',
        '🔞 محتوى غير لائق',
        '🎭 انتحال شخصية',
        '📢 إعلانات/سبام',
        '😡 سلوك مزعج'
    ];
    const [showHideModal, setShowHideModal] = useState(false);
    const [hideDuration, setHideDuration] = useState('24h');
    const [hideReason, setHideReason] = useState('');
    const [hideLoading, setHideLoading] = useState(false);

    const handleHideUser = async () => {
        const targetId = userData?.user?._id || userData?._id;
        if (!targetId) {
            showToast('معرف المستخدم غير متاح', 'error');
            return;
        }
        try {
            setHideLoading(true);
            const res = await hideUser(targetId, {
                duration: hideDuration,
                reason: hideReason.trim()
            });
            if (res.success) {
                showToast('تم إخفاء الحساب وتنبيه المستخدم', 'success');
                setShowHideModal(false);
                setHideReason('');
                setHideDuration('24h');
                fetchUserActivity();
            }
        } catch (err) {
            showToast(err?.response?.data?.message || 'فشل في إخفاء الحساب', 'error');
        } finally {
            setHideLoading(false);
        }
    };

    // ✅ تصفير كل البلاغات على المستخدم + تنبيهه
    const handleClearReports = async () => {
        const targetId = userData?.user?._id || userData?._id;
        if (!targetId) {
            showToast('معرف المستخدم غير متاح', 'error');
            return;
        }
        const count = reportsCount?.totalReports || userData?.reportsCount || 0;
        if (count === 0) {
            showToast('لا توجد بلاغات لتصفيرها', 'info');
            return;
        }
        const ok = window.confirm(
            `🚨 تصفير ${count} بلاغ عن هذا المستخدم؟\n\n` +
            `سيتم:\n` +
            `• إلغاء البلاغات المفتوحة (pending + reviewing)\n` +
            `• تنبيه المستخدم: "تم تصفير ${count} بلاغ، نشكرك على الالتزام"\n\n` +
            `هل تريد المتابعة؟`
        );
        if (!ok) return;

        const reason = window.prompt('سبب اختياري (للأرشيف فقط):', '');
        if (reason === null) return;

        try {
            const res = await clearUserReports(targetId, { reason: reason || '' });
            if (res.success) {
                showToast(res.message || `تم تصفير ${res.data?.clearedCount || 0} بلاغ`, 'success');
                // ✅ تحديث متعدد: userData + reportsCount حتى تختفي الشارة فوراً
                fetchUserActivity();
                fetchReportsCount();
                // ✅ تصفير محلي فوري حتى لو الـ fetch تأخر
                setReportsCount(prev => prev ? { ...prev, totalReports: 0, pendingReports: 0, uniqueReporters: 0 } : prev);
            }
        } catch (err) {
            showToast(err?.response?.data?.message || 'فشل في تصفير البلاغات', 'error');
        }
    };

    const handleUnhideUser = async () => {
        const targetId = userData?.user?._id || userData?._id;
        if (!targetId) return;
        if (!window.confirm('فك إخفاء الحساب وإعادته للظهور؟')) return;
        try {
            const res = await unhideUser(targetId);
            if (res.success) {
                showToast('تم فك إخفاء الحساب', 'success');
                fetchUserActivity();
            }
        } catch (err) {
            showToast('فشل في فك الإخفاء', 'error');
        }
    };

    // Admin Actions State
    const [actionLoading, setActionLoading] = useState(false);
    const [showSuspendModal, setShowSuspendModal] = useState(false);
    const [showNameModal, setShowNameModal] = useState(false);
    const [showNotifyModal, setShowNotifyModal] = useState(false);
    const [showViolationsModal, setShowViolationsModal] = useState(false);
    const [showPhotoDeleteModal, setShowPhotoDeleteModal] = useState(false);
    const [showRestrictModal, setShowRestrictModal] = useState(false);
    const [showPartialModal, setShowPartialModal] = useState(false);
    const [partialForm, setPartialForm] = useState({ action: 'messaging_new', duration: '24h', reason: '', notify: true });

    // Suspend form
    const [suspendForm, setSuspendForm] = useState({ duration: 'auto', customDays: 7, reason: '' });
    // Restrict form
    const [restrictForm, setRestrictForm] = useState({ type: 'photo', duration: '7d', reason: '' });
    // Name action form
    const [nameForm, setNameForm] = useState({ action: 'suspend', reason: '', newName: '' });
    // ✅ تعديل النبذة
    const [editingBio, setEditingBio] = useState(false);
    const [bioText, setBioText] = useState('');
    const [bioSaving, setBioSaving] = useState(false);
    // ✅ Name history modal
    const [showNameHistoryModal, setShowNameHistoryModal] = useState(false);
    const [nameHistoryData, setNameHistoryData] = useState(null);
    const [loadingNameHistory, setLoadingNameHistory] = useState(false);
    // Notification form
    const [notifyForm, setNotifyForm] = useState({ title: '', body: '' });
    // Violations form
    const [violationsCount, setViolationsCount] = useState(0);
    // Photo delete form
    const [photoDeleteForm, setPhotoDeleteForm] = useState({ photoIndex: 'profile', reason: '' });
    // ✅ رفع/استبدال الصورة الشخصية
    const [showPhotoUploadModal, setShowPhotoUploadModal] = useState(false);
    const [photoUploadForm, setPhotoUploadForm] = useState({ file: null, preview: null, reason: '', notify: true });
    const [photoUploadLoading, setPhotoUploadLoading] = useState(false);
    // Reports count
    const [reportsCount, setReportsCount] = useState(null);
    // Photo lightbox
    const [lightboxImage, setLightboxImage] = useState(null);
    const [convFilter, setConvFilter] = useState('all');

    // ========== New State: Violations / Related / Warnings ==========
    const [violationsList, setViolationsList] = useState([]);
    const [violationsLoading, setViolationsLoading] = useState(false);
    const [violationsFilter, setViolationsFilter] = useState('');
    const [relatedAccounts, setRelatedAccounts] = useState(null);
    const [relatedLoading, setRelatedLoading] = useState(false);
    const [warningTemplates, setWarningTemplates] = useState([]);
    const [warningsList, setWarningsList] = useState([]);
    const [warningsLoading, setWarningsLoading] = useState(false);
    const [showWarningModal, setShowWarningModal] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [warningForm, setWarningForm] = useState({ customTitle: '', customBody: '', isBlocking: true, recordViolation: true });
    const [evidenceBlobs, setEvidenceBlobs] = useState({}); // map: violationId -> blob url

    // ========== البلاغات + سجل الصور ==========
    const [reportsData, setReportsData] = useState(null);
    const [reportsLoading, setReportsLoading] = useState(false);
    const [reportsDirection, setReportsDirection] = useState('against'); // against | by
    const [photoHistory, setPhotoHistory] = useState(null);
    const [photoHistoryLoading, setPhotoHistoryLoading] = useState(false);
    const [photoBlobs, setPhotoBlobs] = useState({}); // map: entry index -> blob url

    useEffect(() => {
        fetchUserActivity();
        fetchReportsCount();
        fetchWarningTemplates();
        fetchPromoLogs();
    }, [userId]);

    const fetchPromoLogs = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/banned-words/external-promo/user/${userId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) setPromoLogs(data.data);
        } catch (e) {
            console.error('promoLogs fetch failed', e);
        }
    };

    // lazy-load عند فتح التابات الجديدة
    useEffect(() => {
        if (activeTab === 'violations' && violationsList.length === 0) {
            fetchViolations();
        }
        if (activeTab === 'related' && !relatedAccounts) {
            fetchRelatedAccounts();
        }
        if (activeTab === 'mod-tools' && warningsList.length === 0) {
            fetchWarnings();
        }
        if (activeTab === 'reports' && !reportsData) {
            fetchUserReports();
        }
        if (activeTab === 'photos' && !photoHistory) {
            fetchPhotoHistory();
        }
    // eslint-disable-next-line
    }, [activeTab]);

    const fetchUserActivity = async () => {
        try {
            setLoading(true);
            const response = await getUserActivity(userId);
            setUserData(response.data);
        } catch (error) {
            showToast('فشل في تحميل بيانات المستخدم', 'error');
            console.error('Error fetching user activity:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchReportsCount = async () => {
        try {
            const response = await getUserReportsCount(userId);
            if (response.success) {
                setReportsCount(response.data);
            }
        } catch (error) {
            console.error('Error fetching reports count:', error);
        }
    };

    // ========== Admin Action Handlers ==========

    const handleSuspendUser = async () => {
        try {
            setActionLoading(true);
            const res = await suspendUser(userId, suspendForm.duration === 'custom' ? `${suspendForm.customDays}d` : suspendForm.duration, suspendForm.reason);
            if (res.success) {
                showToast('تم تعليق المستخدم بنجاح', 'success');
                setShowSuspendModal(false);
                setSuspendForm({ duration: 'auto', customDays: 7, reason: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تعليق المستخدم', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleUnsuspendUser = async () => {
        try {
            setActionLoading(true);
            const res = await unsuspendUser(userId);
            if (res.success) {
                showToast('تم إلغاء تعليق المستخدم', 'success');
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في إلغاء التعليق', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSetViolations = async () => {
        try {
            setActionLoading(true);
            const res = await setUserViolations(userId, violationsCount);
            if (res.success) {
                showToast(`تم تحديد المخالفات إلى ${violationsCount}`, 'success');
                setShowViolationsModal(false);
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تحديث المخالفات', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleNameAction = async () => {
        try {
            setActionLoading(true);
            const res = await userNameAction(userId, nameForm.action, nameForm.reason, nameForm.newName);
            if (res.success) {
                const actionText = {
                    'suspend': 'تم تعليق الاسم',
                    'ban': 'تم حظر الاسم',
                    'restore': 'تم استعادة الاسم',
                    'change': 'تم تغيير الاسم'
                };
                showToast(actionText[nameForm.action] || 'تم تنفيذ الإجراء', 'success');
                setShowNameModal(false);
                setNameForm({ action: 'suspend', reason: '', newName: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تنفيذ إجراء الاسم', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // ✅ عرض سجل تغييرات الاسم
    const handleViewNameHistory = async () => {
        try {
            setLoadingNameHistory(true);
            setShowNameHistoryModal(true);
            const res = await getUserNameHistory(userId, 50);
            if (res.success) {
                setNameHistoryData(res.data);
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في جلب السجل', 'error');
            setShowNameHistoryModal(false);
        } finally {
            setLoadingNameHistory(false);
        }
    };

    const handleDeletePhoto = async () => {
        try {
            setActionLoading(true);
            const res = await deleteUserPhoto(userId, photoDeleteForm.photoIndex, photoDeleteForm.reason);
            if (res.success) {
                showToast('تم حذف الصورة وإشعار المستخدم', 'success');
                setShowPhotoDeleteModal(false);
                setPhotoDeleteForm({ photoIndex: 'profile', reason: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في حذف الصورة', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // ✅ اختيار ملف الصورة الجديدة
    const handlePhotoFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('يُرجى اختيار صورة صالحة', 'error');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            showToast('حجم الصورة يجب أن يكون أقل من 2 ميجابايت', 'error');
            return;
        }
        setPhotoUploadForm(prev => ({ ...prev, file, preview: URL.createObjectURL(file) }));
    };

    // ✅ رفع/استبدال الصورة الشخصية + إشعار المستخدم
    const handleUploadPhoto = async () => {
        if (!photoUploadForm.file) {
            showToast('يُرجى اختيار صورة أولاً', 'error');
            return;
        }
        try {
            setPhotoUploadLoading(true);
            const res = await uploadUserProfileImage(
                userId,
                photoUploadForm.file,
                photoUploadForm.reason.trim(),
                photoUploadForm.notify
            );
            if (res.success) {
                showToast(res.message || 'تم تحديث الصورة الشخصية', 'success');
                setShowPhotoUploadModal(false);
                setPhotoUploadForm({ file: null, preview: null, reason: '', notify: true });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تحديث الصورة', 'error');
        } finally {
            setPhotoUploadLoading(false);
        }
    };

    // ✅ منح استثناء — تصفير الحد الشهري لتغيير الاسم + قيد الصورة + إشعار المستخدم
    const handleResetChangeLimits = async () => {
        const ok = window.confirm(
            '🔓 السماح للمستخدم بتغيير الاسم والصورة من جديد؟\n\n' +
            'سيتم:\n' +
            '• تصفير الحد الشهري لتغيير الاسم (3 مرات / 30 يوم)\n' +
            '• رفع قيد الصورة (cooldown)\n' +
            '• إشعار المستخدم أنه يستطيع التعديل الآن\n\n' +
            'ملاحظة: هذا لا يرفع أي حظر إداري على الاسم/الصورة (يُدار من التقييد).'
        );
        if (!ok) return;
        try {
            setActionLoading(true);
            const res = await resetUserChangeLimits(userId, { targets: ['name', 'photo'], notify: true });
            if (res.success) {
                showToast(res.message || 'تم منح الاستثناء وإشعار المستخدم', 'success');
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تصفير الحد', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRestrict = async () => {
        try {
            setActionLoading(true);
            const res = await restrictUser(userId, restrictForm.type, restrictForm.duration, restrictForm.reason);
            if (res.success) {
                showToast(res.message || 'تم تطبيق القيد بنجاح', 'success');
                setShowRestrictModal(false);
                setRestrictForm({ type: 'photo', duration: '7d', reason: '' });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تطبيق القيد', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // ✅ تقييد جزائي موحّد — تطبيق / إلغاء
    const handlePartialAction = async () => {
        try {
            setActionLoading(true);
            let res;
            if (partialForm.action === 'unrestrict') {
                // suspendUser يدعم duration="unrestrict" لفك التقييد + إشعار
                res = await suspendUser(
                    userId,
                    'unrestrict',
                    partialForm.reason || 'إلغاء التقييد من الأدمن',
                    partialForm.notify
                );
            } else {
                // restrictUser يدعم messaging_new / messaging_all + مدة مخصصة
                res = await restrictUser(
                    userId,
                    partialForm.action,            // messaging_new | messaging_all
                    partialForm.duration,          // 24h | 48h | 7d | 30d | 90d | permanent
                    partialForm.reason
                );
            }
            if (res.success) {
                showToast(res.message || 'تم بنجاح', 'success');
                setShowPartialModal(false);
                setPartialForm({ action: 'messaging_new', duration: '24h', reason: '', notify: true });
                fetchUserActivity();
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل تنفيذ الإجراء', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // ========== Violations / Related / Warnings Handlers ==========

    const fetchViolations = async () => {
        try {
            setViolationsLoading(true);
            const res = await getUserViolations(userId, { limit: 100 });
            if (res.success) {
                setViolationsList(res.data.violations || []);
                // Pre-load evidence blobs للـ photo violations
                (res.data.violations || []).forEach(v => {
                    if (v.evidence?.kind === 'photo' && v.evidence?.photoPath) {
                        const filename = v.evidence.photoPath.split('/').pop();
                        if (filename && !evidenceBlobs[v._id]) {
                            fetchViolationEvidenceBlob(userId, filename)
                                .then(url => setEvidenceBlobs(prev => ({ ...prev, [v._id]: url })))
                                .catch(() => {});
                        }
                    }
                });
            }
        } catch (e) {
            showToast('فشل في تحميل سجل المخالفات', 'error');
        } finally {
            setViolationsLoading(false);
        }
    };

    const fetchUserReports = async () => {
        try {
            setReportsLoading(true);
            const res = await getUserReports(userId, { limit: 100 });
            if (res.success) setReportsData(res.data);
        } catch (e) {
            showToast('فشل في تحميل بلاغات المستخدم', 'error');
        } finally {
            setReportsLoading(false);
        }
    };

    const fetchPhotoHistory = async () => {
        try {
            setPhotoHistoryLoading(true);
            const res = await getUserPhotoHistory(userId);
            if (res.success) {
                setPhotoHistory(res.data);
                // الأرشيف محمي — تُجلب كـ blob مع التوكن
                (res.data.history || []).forEach((entry, idx) => {
                    if (!entry.fileName) return;
                    fetchPhotoHistoryBlob(userId, entry.fileName)
                        .then(url => setPhotoBlobs(prev => ({ ...prev, [idx]: url })))
                        // false = فشل الجلب — بلا هذا تبقى البطاقة «جاري التحميل» أبداً
                        .catch(() => setPhotoBlobs(prev => ({ ...prev, [idx]: false })));
                });
            }
        } catch (e) {
            showToast('فشل في تحميل سجل الصور', 'error');
        } finally {
            setPhotoHistoryLoading(false);
        }
    };

    const fetchRelatedAccounts = async () => {
        try {
            setRelatedLoading(true);
            const res = await getRelatedAccounts(userId);
            if (res.success) setRelatedAccounts(res.data);
        } catch (e) {
            showToast('فشل في تحميل الحسابات المرتبطة', 'error');
        } finally {
            setRelatedLoading(false);
        }
    };

    const fetchWarnings = async () => {
        try {
            setWarningsLoading(true);
            const res = await getUserWarnings(userId, { limit: 50 });
            if (res.success) setWarningsList(res.data.warnings || []);
        } catch (e) {
            showToast('فشل في تحميل التنبيهات السابقة', 'error');
        } finally {
            setWarningsLoading(false);
        }
    };

    const fetchWarningTemplates = async () => {
        try {
            const res = await getWarningTemplates();
            if (res.success) setWarningTemplates(res.data.templates || []);
        } catch (e) {
            // silent
        }
    };

    const openWarningModal = (template) => {
        setSelectedTemplate(template);
        setWarningForm({
            customTitle: template.key === 'custom' ? '' : template.title,
            customBody: template.key === 'custom' ? '' : template.body,
            isBlocking: template.isBlocking,
            recordViolation: template.key !== 'custom'
        });
        setShowWarningModal(true);
    };

    const handleSendWarning = async () => {
        if (!selectedTemplate) return;
        if (selectedTemplate.key === 'custom' && !warningForm.customBody.trim()) {
            showToast('النص مطلوب للرسالة المخصصة', 'error');
            return;
        }
        try {
            setActionLoading(true);
            const payload = {
                templateKey: selectedTemplate.key,
                isBlocking: warningForm.isBlocking,
                recordViolation: warningForm.recordViolation
            };
            if (selectedTemplate.key === 'custom') {
                payload.customTitle = warningForm.customTitle;
                payload.customBody = warningForm.customBody;
            }
            const res = await sendOfficialWarning(userId, payload);
            if (res.success) {
                showToast('✅ تم إرسال التنبيه الرسمي', 'success');
                setShowWarningModal(false);
                setSelectedTemplate(null);
                fetchWarnings();
                fetchViolations();
            }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل في إرسال التنبيه', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleDismissWarning = async (warningId) => {
        if (!window.confirm('هل تريد إخفاء هذا التنبيه (سيُغلق الـ modal عند المستخدم)؟')) return;
        try {
            const res = await dismissWarning(warningId);
            if (res.success) {
                showToast('تم إخفاء التنبيه', 'success');
                fetchWarnings();
            }
        } catch (e) {
            showToast('فشل في إخفاء التنبيه', 'error');
        }
    };

    // ========== Quick actions on related accounts ==========
    const handleQuickSuspendRelated = async (uid, uname) => {
        if (!window.confirm(`تعليق ${uname} لمدة 3 أيام؟`)) return;
        try {
            const res = await suspendUser(uid, '3d', 'حساب مرتبط بمستخدم مخالف');
            if (res.success) {
                showToast(`✅ تم تعليق ${uname} 3 أيام`, 'success');
                fetchRelatedAccounts();
            }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل في التعليق', 'error');
        }
    };

    const handleQuickBanRelated = async (uid, uname) => {
        if (!window.confirm(`🚫 حظر نهائي لـ ${uname} + حظر الجهاز؟\n\nلا يمكن التراجع.`)) return;
        try {
            const res = await suspendUser(uid, 'permanent', 'حساب مرتبط بمستخدم مخالف — حظر شبكة');
            if (res.success) {
                showToast(`✅ تم حظر ${uname} نهائياً`, 'success');
                fetchRelatedAccounts();
            }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل في الحظر', 'error');
        }
    };

    // ========== إخفاء كل محادثات المستخدم من التطبيق ==========
    // (الحذف فقط داخل التطبيق — المحادثات تبقى في الأرشيف للمراجعة)
    const handleDeleteAllConversations = async () => {
        if (!window.confirm(`⚠️ إخفاء جميع محادثات ${user.name} من تطبيقه؟\n\nالمحادثات ستختفي فوراً من تطبيق المستخدم لكن تبقى محفوظة في الأرشيف للمراجعة الإدارية.`)) return;

        try {
            setActionLoading(true);
            const res = await deleteAllUserConversations(userId);
            if (res.success) {
                showToast(`✅ ${res.message}`, 'success');
                fetchUserActivity();
            }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل في الإخفاء', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // ========== حذف رسالة واحدة ==========
    const handleDeleteSingleMessage = async (messageId) => {
        if (!window.confirm('حذف هذه الرسالة؟')) return;
        try {
            const res = await deleteUserMessage(userId, messageId);
            if (res.success) {
                showToast('✅ تم حذف الرسالة', 'success');
                fetchUserActivity();
            }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل في الحذف', 'error');
        }
    };

    // ========== تشفير الرسائل كنجوم ==========
    const handleCensorMessages = async (scope) => {
        const scopeText = scope === 'sent' ? 'رسائل هذا المستخدم فقط' : 'كل رسائل جميع محادثاته';
        if (!window.confirm(`*** تشفير ${scopeText}؟\n\nالرسائل ستبقى موجودة لكن محتواها يتحوّل إلى *** — يظهر التأثير فوراً في التطبيق لكل المشاركين.`)) return;

        try {
            setActionLoading(true);
            const res = await censorUserMessages(userId, scope);
            if (res.success) {
                showToast(`✅ ${res.message}`, 'success');
                fetchUserActivity();
            }
        } catch (e) {
            showToast(e.response?.data?.message || 'فشل في التشفير', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSendNotification = async () => {
        if (!notifyForm.title || !notifyForm.body) {
            showToast('العنوان والمحتوى مطلوبان', 'error');
            return;
        }
        try {
            setActionLoading(true);
            const res = await sendUserNotification(notifyForm.title, notifyForm.body, userId, 'id');
            if (res.success) {
                showToast('تم إرسال الإشعار بنجاح', 'success');
                setShowNotifyModal(false);
                setNotifyForm({ title: '', body: '' });
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في إرسال الإشعار', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    // ✅ حساب عدد تغييرات الاسم المستخدمة خلال آخر 30 يوم (الحد = 3)
    const getNameChangeUsage = () => {
        const MAX = 3;
        const windowMs = 30 * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - windowMs;
        let history = (userData?.user?.nameChangeHistory || [])
            .map(d => new Date(d).getTime())
            .filter(t => t > cutoff);
        if (history.length === 0 && userData?.user?.lastNameChange) {
            const last = new Date(userData.user.lastNameChange).getTime();
            if (last > cutoff) history = [last];
        }
        return { used: history.length, max: MAX, reached: history.length >= MAX };
    };

    const formatDate = (date) => formatDateTimeLong(date) === '-' ? 'غير محدد' : formatDateTimeLong(date);
    const formatBirthDate = (date) => formatDateLong(date) === '-' ? 'غير محدد' : formatDateLong(date);

    const calculateAge = (birthDate) => {
        if (!birthDate) return null;
        const today = new Date();
        const birth = new Date(birthDate);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDiff = today.getMonth() - birth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    };

    const getGenderText = (gender) => {
        switch (gender) {
            case 'male': return 'ذكر';
            case 'female': return 'أنثى';
            default: return 'غير محدد';
        }
    };

    const getAuthProviderText = (provider) => {
        switch (provider) {
            case 'google': return 'Google';
            case 'apple': return 'Apple';
            case 'facebook': return 'Facebook';
            case 'app': return 'التطبيق';
            default: return 'غير محدد';
        }
    };

    const getAuthProviderIcon = (provider) => {
        switch (provider) {
            case 'google': return '🔵';
            case 'apple': return '🍎';
            case 'facebook': return '🔷';
            case 'app': return '📱';
            default: return '❓';
        }
    };


    const getAccountAge = (createdAt) => {
        if (!createdAt) return '';
        const now = new Date();
        const created = new Date(createdAt);
        const diffMs = now - created;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays < 1) return 'اليوم';
        if (diffDays < 30) return `منذ ${diffDays} يوم`;
        const diffMonths = Math.floor(diffDays / 30);
        if (diffMonths < 12) return `منذ ${diffMonths} شهر`;
        const diffYears = Math.floor(diffMonths / 12);
        return `منذ ${diffYears} سنة`;
    };

    const getTimeSince = (date) => {
        if (!date) return 'غير معروف';
        const now = new Date();
        const d = new Date(date);
        const diffMs = now - d;
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'الآن';
        if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `منذ ${diffHours} ساعة`;
        const diffDays = Math.floor(diffHours / 24);
        return `منذ ${diffDays} يوم`;
    };

    const buildTimelineEvents = () => {
        if (!userData) return [];
        const events = [];
        // Account creation
        if (user.createdAt) {
            events.push({ date: user.createdAt, type: 'created', color: 'green', icon: '🟢', text: 'إنشاء الحساب' });
        }
        // Suspension history
        if (user.suspension?.history) {
            user.suspension.history.forEach(h => {
                events.push({
                    date: h.suspendedAt || h.date,
                    type: 'suspension',
                    color: 'red',
                    icon: '🔴',
                    text: `تعليق — المستوى ${h.level} — ${h.reason || 'بدون سبب'}`,
                    detail: h.suspendedUntil ? `حتى ${new Date(h.suspendedUntil).toLocaleDateString('ar-SA')}` : 'دائم'
                });
            });
        }
        // Warnings history
        if (user.warnings?.history) {
            user.warnings.history.forEach(w => {
                events.push({
                    date: w.date || w.createdAt,
                    type: 'warning',
                    color: 'yellow',
                    icon: '🟡',
                    text: `تحذير — ${w.reason || w.message || 'بدون سبب'}`
                });
            });
        }
        // Appeals
        if (userData.appeals) {
            (Array.isArray(userData.appeals) ? userData.appeals : []).forEach(a => {
                events.push({
                    date: a.createdAt || a.date,
                    type: 'appeal',
                    color: a.status === 'approved' ? 'green' : 'blue',
                    icon: a.status === 'approved' ? '🟢' : '🔵',
                    text: `استئناف — ${a.status === 'approved' ? 'مقبول' : a.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}`,
                    detail: a.reason || a.message || ''
                });
            });
        }
        // Recent reports received
        if (userData.recentReportsReceived) {
            (Array.isArray(userData.recentReportsReceived) ? userData.recentReportsReceived : []).forEach(r => {
                events.push({
                    date: r.createdAt || r.date,
                    type: 'report',
                    color: 'red',
                    icon: '🔴',
                    text: `بلاغ — ${r.reason || r.type || 'غير محدد'}`,
                    detail: r.description || ''
                });
            });
        }
        // Sort newest first
        events.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        return events;
    };

    if (loading) {
        return (
            <div className="user-detail">
                <div className="loading">جاري التحميل...</div>
            </div>
        );
    }

    if (!userData) {
        return (
            <div className="user-detail">
                <div className="error">لم يتم العثور على بيانات المستخدم</div>
            </div>
        );
    }

    const { user, stats, conversations, recentMessages } = userData;
    const userAge = calculateAge(user.birthDate);

    // عرض تفاصيل محادثة
    if (viewingConversationId && !viewingConversationMessages) {
        return (
            <ConversationDetail
                conversationId={viewingConversationId}
                onBack={() => setViewingConversationId(null)}
            />
        );
    }

    // عرض رسائل محادثة مباشرة
    if (viewingConversationId && viewingConversationMessages) {
        return (
            <ConversationMessages
                conversationId={viewingConversationId}
                onBack={() => {
                    setViewingConversationId(null);
                    setViewingConversationMessages(false);
                }}
                onViewUser={onNavigateToUser}
            />
        );
    }

    return (
        <div className="user-detail">
            <div className="detail-header">
                <button onClick={onBack} className="back-btn">
                    ← رجوع
                </button>
                <h2>تفاصيل المستخدم</h2>
            </div>

            {/* User Info Card */}
            <div className="user-info-card">
                <div className="user-avatar-container">
                    {user.profileImage ? (
                        <img
                            src={getImageUrl(user.profileImage)}
                            alt={user.name}
                            className="user-avatar-image"
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = getDefaultAvatar(user.name);
                            }}
                        />
                    ) : (
                        <div className="user-avatar-large">
                            {user.name.charAt(0)}
                        </div>
                    )}
                    <span className={`status-indicator ${user.isActive ? 'online' : 'offline'}`}></span>
                </div>
                <div className="user-info-details">
                    <h3>{user.name}</h3>
                    <p className="user-email" style={{display:"flex",alignItems:"center",gap:"6px"}}>
                        {user.email}
                        <button
                            title="تغيير البريد الإلكتروني"
                            style={{background:"none",border:"none",cursor:"pointer",fontSize:"13px",padding:"0"}}
                            disabled={actionLoading}
                            onClick={async () => {
                                const newEmail = window.prompt("البريد الإلكتروني الجديد لـ " + user.name + ":", user.email || "");
                                if (newEmail === null) return;
                                const email = newEmail.trim().toLowerCase();
                                if (!/^\S+@\S+\.\S+$/.test(email)) {
                                    showToast("البريد الإلكتروني غير صالح", "error");
                                    return;
                                }
                                if (email === (user.email || "").toLowerCase()) return;
                                const socialWarning = (user.authProvider && user.authProvider !== "app")
                                    ? "\n\n⚠️ هذا الحساب مسجّل عبر " + user.authProvider + " — تغيير البريد لا يفكّ ربطه بالمزوّد."
                                    : "";
                                if (!window.confirm("تغيير بريد الدخول إلى:\n" + email + "؟" + socialWarning)) return;
                                try {
                                    setActionLoading(true);
                                    const { updateUser } = await import("../services/api");
                                    const res = await updateUser(user._id, { email });
                                    if (res.success) {
                                        showToast("تم تغيير البريد الإلكتروني", "success");
                                        fetchUserActivity();
                                    } else {
                                        showToast(res.message || "فشل تغيير البريد", "error");
                                    }
                                } catch (e) {
                                    showToast(e.response?.data?.message || "فشل تغيير البريد", "error");
                                } finally {
                                    setActionLoading(false);
                                }
                            }}
                        >
                            ✏️
                        </button>
                    </p>
                    <p className="user-id" style={{fontSize: '12px', color: 'var(--text-muted)', direction: 'ltr', textAlign: 'right', margin: '2px 0 8px', fontFamily: 'monospace', cursor: 'pointer'}}
                       onClick={() => { navigator.clipboard.writeText(user._id); showToast('تم نسخ المعرف', 'success'); }}
                       title="انقر للنسخ">
                        {user.halaId ? `معرف هلا: ${user.halaId}` : `ID: ${user._id}`}
                    </p>
                    <div className="user-badges">
                        <span className={`role-badge ${user.role}`}>
                            {user.role === 'admin' ? 'مدير' : 'مستخدم'}
                        </span>
                        <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                            {user.isActive ? 'نشط' : 'غير نشط'}
                        </span>
                        <span className="auth-badge">
                            {getAuthProviderIcon(user.authProvider)} {getAuthProviderText(user.authProvider)}
                        </span>
                    </div>
                    {/* Enhanced badges row */}
                    <div className="user-badges" style={{marginTop: '6px'}}>
                        <span className="account-age-badge" title={formatDate(user.createdAt)}>
                            🕐 {getAccountAge(user.createdAt)}
                        </span>
                        {user.isOnline ? (
                            <span className="online-status-badge online">🟢 متصل الآن</span>
                        ) : (
                            <span className="online-status-badge offline">آخر ظهور: {getTimeSince(user.lastLogin)}</span>
                        )}
                        {(() => {
                            const expiryValid = user.premiumExpiresAt
                                ? new Date(user.premiumExpiresAt) > new Date()
                                : false;
                            const subActive = user.subscription?.isActive;
                            const isActivePremium = (user.isPremium && expiryValid) || subActive;
                            const isExpiredPremium = user.isPremium && !expiryValid && !subActive;
                            if (isActivePremium) {
                                return <span className="premium-badge">⭐ Premium</span>;
                            }
                            if (isExpiredPremium) {
                                return <span className="premium-badge premium-expired" title="اشتراك منتهي — سيتم إلغاؤه تلقائياً">⏰ Premium (منتهي)</span>;
                            }
                            return null;
                        })()}
                        {(reportsCount?.totalReports > 0 || userData?.reportsCount > 0) && (
                            <>
                                <span className="reports-badge">🚨 {reportsCount?.totalReports || userData?.reportsCount || 0} بلاغ</span>
                                <button
                                    onClick={handleClearReports}
                                    title="تصفير كل البلاغات المفتوحة + تنبيه المستخدم بشكر التزامه"
                                    style={{
                                        marginInlineStart: 6,
                                        padding: '4px 10px',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        background: 'linear-gradient(135deg,#10b981,#059669)',
                                        color: 'var(--text-on-brand)',
                                        border: 'none',
                                        borderRadius: 999,
                                        cursor: 'pointer',
                                        boxShadow: '0 2px 4px rgba(16,185,129,0.3)'
                                    }}
                                >
                                    ✓ تصفير + شكر
                                </button>
                            </>
                        )}
                    </div>
                    <p className="user-joined">
                        انضم في: {formatDate(user.createdAt)}
                    </p>
                    {user.lastLogin && (
                        <p className="user-last-login">
                            آخر دخول: {formatDate(user.lastLogin)}
                        </p>
                    )}
                </div>
            </div>

            {/* Suspension Status Bar */}
            <div className={`suspension-status-bar ${
                user.suspension?.isSuspended
                    ? (user.suspension.suspendedUntil ? 'temp-suspended' : 'perm-suspended')
                    : user.restrictions?.messagingRestricted
                        ? 'restricted'
                        : 'active-account'
            }`}>
                {user.suspension?.isSuspended ? (
                    user.suspension.suspendedUntil ? (
                        <span>🟡 معلّق مؤقتاً — حتى {formatDate(user.suspension.suspendedUntil)}</span>
                    ) : (
                        <span>🔴 معلّق نهائياً</span>
                    )
                ) : user.restrictions?.messagingRestricted ? (
                    <span>🟠 مقيّد — الرسائل محظورة</span>
                ) : (
                    <span>🟢 حساب نشط</span>
                )}
            </div>

            {/* ✅ Hidden Status Bar */}
            {user.hidden?.isHidden && (!user.hidden.hiddenUntil || new Date(user.hidden.hiddenUntil) > new Date()) && (
                <div style={{
                    margin: '8px 0',
                    padding: '10px 14px',
                    background: 'linear-gradient(135deg,#fef3c7,#fde68a)',
                    border: '1px solid #f59e0b',
                    borderRadius: 10,
                    color: '#78350f',
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                }}>
                    🙈 <strong>الحساب مخفي عن العام</strong>
                    {user.hidden.hiddenUntil ? (
                        <span>— حتى {formatDate(user.hidden.hiddenUntil)}</span>
                    ) : (
                        <span>— بشكل دائم</span>
                    )}
                    {user.hidden.reason && <span style={{ opacity: 0.8 }}>· السبب: {user.hidden.reason}</span>}
                </div>
            )}

            {/* Quick Actions Row */}
            <div className="quick-actions-row">
                {user.suspension?.isSuspended ? (
                    <button className="quick-action-btn unsuspend" onClick={handleUnsuspendUser} disabled={actionLoading}>
                        🔓 فك التعليق
                    </button>
                ) : (
                    <button className="quick-action-btn suspend" onClick={() => setShowSuspendModal(true)} disabled={actionLoading}>
                        ⛔ تعليق
                    </button>
                )}
                {user.hidden?.isHidden && (!user.hidden.hiddenUntil || new Date(user.hidden.hiddenUntil) > new Date()) ? (
                    <button
                        className="quick-action-btn"
                        onClick={handleUnhideUser}
                        disabled={actionLoading}
                        style={{ background: '#10b981', color: 'var(--text-on-brand)' }}
                    >
                        👁️ إظهار الحساب
                    </button>
                ) : (
                    <button
                        className="quick-action-btn"
                        onClick={() => setShowHideModal(true)}
                        disabled={actionLoading}
                        style={{ background: '#f59e0b', color: 'var(--text-on-brand)' }}
                        title="إخفاء الحساب من الاكتشاف والبحث (المستخدم يستطيع الدخول لكن لا يظهر للآخرين)"
                    >
                        🙈 إخفاء الحساب
                    </button>
                )}
                <button className="quick-action-btn notify" onClick={() => setShowNotifyModal(true)} disabled={actionLoading}>
                    📩 إرسال إشعار
                </button>
                <button className="quick-action-btn copy-id" onClick={() => { navigator.clipboard.writeText(user._id); showToast('تم نسخ المعرف', 'success'); }}>
                    📋 نسخ المعرف
                </button>
            </div>

            {/* Tabs Navigation — على الجوال شريط أفقي؛ ref لتمرير النشط إلى المنتصف */}
            <div
                className="tabs-navigation"
                ref={(el) => {
                    if (!el || window.innerWidth > 768) return;
                    const active = el.querySelector('.tab-btn.active');
                    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
                }}
            >
                <button
                    className={`tab-btn ${activeTab === 'info' ? 'active' : ''}`}
                    onClick={() => setActiveTab('info')}
                >
                    👤 المعلومات الشخصية
                </button>
                <button
                    className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
                    onClick={() => setActiveTab('stats')}
                >
                    📊 الإحصائيات
                </button>
                <button
                    className={`tab-btn ${activeTab === 'conversations' ? 'active' : ''}`}
                    onClick={() => setActiveTab('conversations')}
                >
                    💬 المحادثات
                </button>
                <button
                    className={`tab-btn ${activeTab === 'messages' ? 'active' : ''}`}
                    onClick={() => setActiveTab('messages')}
                >
                    📨 الرسائل
                </button>
                <button
                    className={`tab-btn ${activeTab === 'photos' ? 'active' : ''}`}
                    onClick={() => setActiveTab('photos')}
                >
                    🖼️ الصور ({(user.photos?.length || 0) + (user.profileImage ? 1 : 0)})
                </button>
                <button
                    className={`tab-btn ${activeTab === 'timeline' ? 'active' : ''}`}
                    onClick={() => setActiveTab('timeline')}
                >
                    📜 سجل الأحداث
                </button>
                <button
                    className={`tab-btn ${activeTab === 'violations' ? 'active' : ''}`}
                    onClick={() => setActiveTab('violations')}
                >
                    ⚠️ سجل المخالفات
                </button>
                <button
                    className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
                    onClick={() => setActiveTab('reports')}
                >
                    🚩 البلاغات{reportsCount?.totalReports ? ` (${reportsCount.totalReports})` : ''}
                </button>
                <button
                    className={`tab-btn ${activeTab === 'related' ? 'active' : ''}`}
                    onClick={() => setActiveTab('related')}
                >
                    👥 حسابات مرتبطة
                </button>
                <button
                    className={`tab-btn ${activeTab === 'mod-tools' ? 'active' : ''}`}
                    onClick={() => setActiveTab('mod-tools')}
                >
                    🛡️ أدوات الإشراف
                </button>
                <button
                    className={`tab-btn ${activeTab === 'admin-actions' ? 'active' : ''}`}
                    onClick={() => {
                        setActiveTab('admin-actions');
                        setViolationsCount(user.bannedWords?.violations || 0);
                    }}
                >
                    ⚙️ إجراءات الأدمن
                </button>
            </div>

            {/* Tab Content */}
            <div className="tab-content">
                {/* Personal Info Tab */}
                {activeTab === 'info' && (
                    <div className="personal-info-section">
                        <h3>👤 المعلومات الشخصية</h3>
                        <div className="info-grid">
                            <div className="info-item">
                                <span className="info-icon">🎂</span>
                                <div className="info-content">
                                    <p className="info-label">تاريخ الميلاد</p>
                                    <p className="info-value">
                                        {formatBirthDate(user.birthDate)}
                                        {userAge && <span className="age-badge">({userAge} سنة)</span>}
                                    </p>
                                </div>
                            </div>
                            <div className="info-item">
                                <span className="info-icon">⚧</span>
                                <div className="info-content">
                                    <p className="info-label">الجنس</p>
                                    <p className="info-value">{getGenderText(user.gender)}</p>
                                </div>
                            </div>
                            <div className="info-item">
                                <span className="info-icon">🌍</span>
                                <div className="info-content">
                                    <p className="info-label">الدولة</p>
                                    <p className="info-value">{user.country || 'غير محدد'}</p>
                                </div>
                            </div>
                            <div className="info-item">
                                <span className="info-icon">🔐</span>
                                <div className="info-content">
                                    <p className="info-label">طريقة التسجيل</p>
                                    <p className="info-value">
                                        {getAuthProviderIcon(user.authProvider)} {getAuthProviderText(user.authProvider)}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* موقع المستخدم — مصدران منفصلان عمداً:
                            GPS دقيق لمن منح الإذن، و IP تقريبي يغطّي الجميع.
                            دمجهما في سطر واحد يخفي عن الأدمن أيّهما يقرأ. */}
                        {(() => {
                            const gps = gpsCoords(user);
                            const ip = ipCoords(user);
                            const gpsPlace = placeText(user.gpsLocation?.city, user.gpsLocation?.country);
                            const ipPlace = placeText(user.ipLocation?.city, user.ipLocation?.region)
                                || placeText(user.ipLocation?.city, user.ipLocation?.country);
                            const hasGps = !!(gps || gpsPlace);
                            const hasIp = !!(ip || ipPlace || user.ipLocation?.ip);
                            if (!hasGps && !hasIp) {
                                return (
                                    <div className="location-section">
                                        <h4>📍 الموقع</h4>
                                        <p className="location-empty">
                                            لا يوجد موقع بعد — لم يمنح المستخدم إذن الموقع ولم يُسجَّل دخول جديد منذ تفعيل استنتاج IP.
                                        </p>
                                    </div>
                                );
                            }
                            const gap = (gps && ip) ? distanceKm(gps, ip) : null;
                            return (
                                <div className="location-section">
                                    <h4>📍 الموقع</h4>
                                    <div className="location-cards">
                                        {hasGps && (
                                            <div className="location-card loc-card-gps">
                                                <div className="location-card-head">
                                                    <span className="location-badge gps">GPS — من التطبيق</span>
                                                    {user.gpsLocation?.updatedAt && (
                                                        <span className="location-time">{formatDateTimeLong(user.gpsLocation.updatedAt)}</span>
                                                    )}
                                                </div>
                                                <p className="location-place">{gpsPlace || 'مدينة غير معروفة'}</p>
                                                {gps && (
                                                    <p className="location-coords">
                                                        {formatCoords(gps)}
                                                        <a href={mapsUrl(gps)} target="_blank" rel="noopener noreferrer" className="map-link">
                                                            عرض على الخريطة
                                                        </a>
                                                    </p>
                                                )}
                                                {user.gpsLocation?.accuracy != null && (
                                                    <p className="location-meta">دقة تقريبية: ±{Math.round(user.gpsLocation.accuracy)} م</p>
                                                )}
                                            </div>
                                        )}
                                        {hasIp && (
                                            <div className="location-card loc-card-ip">
                                                <div className="location-card-head">
                                                    <span className="location-badge ip">IP — تقريبي</span>
                                                    {user.ipLocation?.updatedAt && (
                                                        <span className="location-time">{formatDateTimeLong(user.ipLocation.updatedAt)}</span>
                                                    )}
                                                </div>
                                                <p className="location-place">{ipPlace || 'مدينة غير معروفة'}</p>
                                                {ip && (
                                                    <p className="location-coords">
                                                        {formatCoords(ip)}
                                                        <a href={mapsUrl(ip)} target="_blank" rel="noopener noreferrer" className="map-link">
                                                            عرض على الخريطة
                                                        </a>
                                                    </p>
                                                )}
                                                {user.ipLocation?.ip && (
                                                    <p className="location-meta">IP: {user.ipLocation.ip}</p>
                                                )}
                                                {user.ipLocation?.timezone && (
                                                    <p className="location-meta">المنطقة الزمنية: {user.ipLocation.timezone}</p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    {gap != null && gap >= MISMATCH_KM && (
                                        <p className="location-mismatch">
                                            ⚠️ تباعد {gap} كم بين موقع GPS وموقع IP — مؤشّر VPN أو موقع مزيّف.
                                        </p>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Interests Section */}
                        {user.interests && user.interests.length > 0 && (
                            <div className="interests-section" style={{marginTop: '20px'}}>
                                <h4>✨ الاهتمامات</h4>
                                <div className="interest-chips">
                                    {user.interests.map((interest, idx) => (
                                        <span key={idx} className="interest-chip">{interest}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Bio Section — مع تعديل */}
                        <div className="bio-section">
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                                <h4 style={{margin:0}}>📝 نبذة عن المستخدم {user.bioStatus?.status === 'banned' ? <span className="bio-status-badge banned">🔴 محظورة</span> : user.bio ? <span className="bio-status-badge normal">🟢 عادية</span> : null}</h4>
                                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                                    {user.nameStatus?.status && user.nameStatus.status !== 'normal' && (
                                        <span className="name-status-inline-badge">{user.nameStatus.status === 'banned' ? '🔴 الاسم محظور' : '🟡 الاسم معلّق'}</span>
                                    )}
                                    {!editingBio && (
                                        <button
                                            onClick={() => { setBioText(user.bio || ''); setEditingBio(true); }}
                                            style={{padding:"4px 12px",borderRadius:"8px",border:"1px solid #6366f1",background:"#eef2ff",color:"#4338ca",fontSize:"12px",fontWeight:600,cursor:"pointer"}}
                                        >
                                            ✏️ تعديل
                                        </button>
                                    )}
                                    {!editingBio && user.bio && (
                                        user.bioStatus?.status === "banned" ? (
                                            <button onClick={async () => { try { const r = await userBioAction(userId, "restore"); if(r.success){showToast("تم إعادة النبذة","success");fetchUserActivity();}} catch(e){showToast("فشل","error")}}} style={{padding:"4px 12px",borderRadius:"8px",border:"1px solid #22c55e",background:"#dcfce7",color:"#166534",fontSize:"12px",cursor:"pointer"}}>↩️ إعادة النبذة</button>
                                        ) : (
                                            <button onClick={async () => { try { const r = await userBioAction(userId, "ban", "نبذة مخالفة"); if(r.success){showToast("تم حظر النبذة","success");fetchUserActivity();}} catch(e){showToast("فشل","error")}}} style={{padding:"4px 12px",borderRadius:"8px",border:"1px solid #ef4444",background:"#fef2f2",color:"#dc2626",fontSize:"12px",cursor:"pointer"}}>🚫 حظر النبذة</button>
                                        )
                                    )}
                                </div>
                            </div>
                            <div className="bio-content">
                                {editingBio ? (
                                    <div>
                                        <textarea
                                            value={bioText}
                                            onChange={(e) => setBioText(e.target.value)}
                                            placeholder="اكتب النبذة هنا..."
                                            maxLength={500}
                                            rows={4}
                                            disabled={bioSaving}
                                            style={{
                                                width:"100%", padding:"10px 12px",
                                                border:"1.5px solid #d1d5db", borderRadius:8,
                                                fontSize:14, fontFamily:"inherit",
                                                resize:"vertical", direction:"rtl",
                                                boxSizing:"border-box"
                                            }}
                                        />
                                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,flexWrap:"wrap",gap:8}}>
                                            <span style={{fontSize:11,color:"#6b7280"}}>
                                                {bioText.length}/500 حرف
                                            </span>
                                            <div style={{display:"flex",gap:6}}>
                                                <button
                                                    onClick={() => { setEditingBio(false); setBioText(''); }}
                                                    disabled={bioSaving}
                                                    style={{padding:"6px 14px",borderRadius:8,border:"1px solid #d1d5db",background:"#fff",fontSize:13,cursor:"pointer",fontWeight:600}}
                                                >
                                                    إلغاء
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        setBioSaving(true);
                                                        try {
                                                            const r = await editUserBio(userId, bioText);
                                                            if (r.success) {
                                                                showToast('تم تحديث النبذة بنجاح','success');
                                                                setEditingBio(false);
                                                                fetchUserActivity();
                                                            } else {
                                                                showToast(r.message || 'فشل التحديث','error');
                                                            }
                                                        } catch(e) {
                                                            showToast(e.response?.data?.message || 'فشل التحديث','error');
                                                        } finally {
                                                            setBioSaving(false);
                                                        }
                                                    }}
                                                    disabled={bioSaving}
                                                    style={{padding:"6px 18px",borderRadius:8,border:"none",background:"#6366f1",color:"#fff",fontSize:13,fontWeight:700,cursor:bioSaving?"wait":"pointer"}}
                                                >
                                                    {bioSaving ? 'جاري الحفظ...' : '💾 حفظ'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    user.bio ? (
                                        <p>{user.bio}</p>
                                    ) : (
                                        <p className="no-bio">لم يتم إضافة نبذة</p>
                                    )
                                )}
                            </div>
                        </div>

                        {/* Privacy Settings */}
                        {user.privacySettings && (
                            <div className="privacy-section">
                                <h4>🔒 إعدادات الخصوصية</h4>
                                <div className="privacy-grid">
                                    <div className="privacy-item">
                                        <span className="privacy-label">ظهور الملف الشخصي:</span>
                                        <span className="privacy-value">
                                            {user.privacySettings.profileVisibility === 'public' && '🌐 عام'}
                                            {user.privacySettings.profileVisibility === 'contacts' && '👥 جهات الاتصال'}
                                            {user.privacySettings.profileVisibility === 'private' && '🔒 خاص'}
                                        </span>
                                    </div>
                                    <div className="privacy-item">
                                        <span className="privacy-label">إظهار آخر ظهور:</span>
                                        <span className="privacy-value">
                                            {user.privacySettings.showLastSeen ? '✅ مفعل' : '❌ معطل'}
                                        </span>
                                    </div>
                                    <div className="privacy-item">
                                        <span className="privacy-label">صوت الإشعارات:</span>
                                        <span className="privacy-value">
                                            {user.privacySettings.notificationSound ? '🔔 مفعل' : '🔕 معطل'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Device Info */}
                        {user.deviceInfo && (user.deviceInfo.platform || user.deviceInfo.osVersion || user.deviceInfo.appVersion) && (
                            <div className="device-section">
                                <h4>📱 معلومات الجهاز</h4>
                                <div className="device-grid">
                                    {user.deviceInfo.platform && (
                                        <div className="device-item">
                                            <span className="device-label">النظام:</span>
                                            <span className="device-value">{user.deviceInfo.platform}</span>
                                        </div>
                                    )}
                                    {user.deviceInfo.osVersion && (
                                        <div className="device-item">
                                            <span className="device-label">إصدار النظام:</span>
                                            <span className="device-value">{user.deviceInfo.osVersion}</span>
                                        </div>
                                    )}
                                    {user.deviceInfo.appVersion && (
                                        <div className="device-item">
                                            <span className="device-label">إصدار التطبيق:</span>
                                            <span className="device-value">{user.deviceInfo.appVersion}</span>
                                        </div>
                                    )}
                                    <div className="device-item">
                                        <span className="device-label">آخر تحديث للبصمة:</span>
                                        <span className="device-value">
                                            {user.lastFingerprintUpdate
                                                ? formatDate(user.lastFingerprintUpdate)
                                                : <span style={{color:'#dc2626'}}>لم يسجّل بصمة بعد</span>}
                                        </span>
                                    </div>
                                </div>

                                {/* 🔔 حالة الإشعارات */}
                                {(() => {
                                    const ph = user.pushHealth || {};
                                    const hasToken = !!(user.deviceToken || user.fcmToken);
                                    const consec = ph.consecutiveFailures || 0;
                                    const totalSuccess = ph.totalSuccess || 0;
                                    const totalFailures = ph.totalFailures || 0;
                                    const successRate = (totalSuccess + totalFailures) > 0
                                        ? Math.round((totalSuccess / (totalSuccess + totalFailures)) * 100)
                                        : null;

                                    let statusColor = '#10b981';  // green
                                    let statusBg = '#ecfdf5';
                                    let statusBorder = '#a7f3d0';
                                    let statusIcon = '✅';
                                    let statusLabel = 'تعمل بشكل طبيعي';
                                    let statusDetail = ph.lastSuccessAt ? `آخر نجاح: ${formatDate(ph.lastSuccessAt)}` : '';

                                    if (ph.notificationsDisabled) {
                                        statusColor = '#dc2626';
                                        statusBg = '#fef2f2';
                                        statusBorder = '#fecaca';
                                        statusIcon = '🔕';
                                        statusLabel = 'الإشعارات معطّلة فعلياً';
                                        statusDetail = `${consec} فشل متتالي. آخر سبب: ${ph.lastError || 'غير محدد'}`;
                                    } else if (!hasToken && ph.noTokenSince) {
                                        const daysAgo = Math.floor((Date.now() - new Date(ph.noTokenSince).getTime()) / (24 * 60 * 60 * 1000));
                                        statusColor = '#f59e0b';
                                        statusBg = '#fef3c7';
                                        statusBorder = '#fcd34d';
                                        statusIcon = '⚠️';
                                        statusLabel = 'بدون FCM token';
                                        statusDetail = `منذ ${daysAgo} يوم — سيتم طلب tokenة عند فتح التطبيق`;
                                    } else if (consec >= 3) {
                                        statusColor = '#f59e0b';
                                        statusBg = '#fef3c7';
                                        statusBorder = '#fcd34d';
                                        statusIcon = '⚠️';
                                        statusLabel = `فشل متتالي (${consec})`;
                                        statusDetail = `آخر سبب: ${ph.lastError || 'غير محدد'}`;
                                    } else if (!ph.lastSuccessAt && !hasToken) {
                                        statusColor = '#9ca3af';
                                        statusBg = '#f9fafb';
                                        statusBorder = '#e5e7eb';
                                        statusIcon = '⚪';
                                        statusLabel = 'لم يستقبل أي إشعار بعد';
                                        statusDetail = 'مستخدم جديد أو لم يفعّل الإشعارات';
                                    }

                                    return (
                                        <div style={{marginTop:14, padding:12, background:statusBg, border:`1px solid ${statusBorder}`, borderRadius:10}}>
                                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                                                <span style={{fontSize:18}}>{statusIcon}</span>
                                                <strong style={{color:statusColor}}>الإشعارات: {statusLabel}</strong>
                                            </div>
                                            {statusDetail && (
                                                <div style={{fontSize:12, color: 'var(--text-secondary)', marginRight:26}}>
                                                    {statusDetail}
                                                </div>
                                            )}
                                            {(totalSuccess > 0 || totalFailures > 0) && (
                                                <div style={{marginTop:8, display:'flex', gap:12, fontSize:11, color: 'var(--text-secondary)', marginRight:26}}>
                                                    <span>✅ نجاح: {totalSuccess}</span>
                                                    <span>❌ فشل: {totalFailures}</span>
                                                    {successRate !== null && (
                                                        <span style={{fontWeight:600, color: successRate >= 80 ? '#059669' : (successRate >= 50 ? '#d97706' : '#dc2626')}}>
                                                            معدل النجاح: {successRate}%
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            {/* ✅ تفاصيل آخر فشل — تُعرض دائماً متى وُجد فشل،
                                                حتى لو كانت الحالة العامة سليمة (كان يُخفى إلا عند 3 فشل متتالي فأكثر) */}
                                            {totalFailures > 0 && (ph.lastError || ph.lastFailureAt) && !ph.notificationsDisabled && consec < 3 && (
                                                <div style={{marginTop:8, paddingTop:8, borderTop:'1px dashed #d1d5db', fontSize:11, color: 'var(--text-secondary)', marginRight:26}}>
                                                    <div style={{fontWeight:600, marginBottom:2, color: 'var(--text-secondary)'}}>تفاصيل آخر فشل:</div>
                                                    {ph.lastFailureAt && <div>متى: {formatDate(ph.lastFailureAt)}</div>}
                                                    {ph.lastError && (
                                                        <div style={{direction:'ltr', textAlign:'right', wordBreak:'break-word', fontFamily:'monospace', marginTop:2}}>
                                                            {ph.lastError}
                                                        </div>
                                                    )}
                                                    <div style={{marginTop:4, color: 'var(--text-muted)'}}>
                                                        {String(ph.lastError || '').includes('registration-token-not-registered')
                                                            ? 'الرمز لم يعد صالحاً (حذف التطبيق أو تجدّد الرمز) — طبيعي، يُحل عند فتح التطبيق.'
                                                            : 'فشل متفرّق — لا يؤثر ما دام معدل النجاح مرتفعاً والعداد المتتالي = 0.'}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {/* تحذير غياب البصمة */}
                        {!user.lastFingerprintUpdate && (
                            <div style={{marginTop:16,padding:14,background:'var(--tint-warning)',border:'1px solid #f59e0b',borderRadius:12,color: 'var(--text-warning)',display:'flex',alignItems:'flex-start',gap:10}}>
                                <span style={{fontSize:22}}>⚠️</span>
                                <div>
                                    <div style={{fontWeight:700,marginBottom:4}}>لا توجد بصمة جهاز لهذا المستخدم</div>
                                    <div style={{fontSize:13,lineHeight:1.6}}>
                                        المستخدم لم يسجّل دخول من التطبيق المحدّث. لن يعمل حظر الجهاز عليه إلا بعد تحديث التطبيق.
                                        <br/>سيتم تحديث البصمة تلقائياً عند فتحه للتطبيق المحدّث (أي request من بعد التحديث).
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Stats Tab */}
                {activeTab === 'stats' && (
                    <div className="stats-section">
                        <h3>📊 إحصائيات النشاط</h3>
                        <div className="stats-grid">
                            <div className="stat-card">
                                <div className="stat-icon">💬</div>
                                <div className="stat-info">
                                    <p className="stat-label">المحادثات</p>
                                    <p className="stat-value">{stats.totalConversations}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">📨</div>
                                <div className="stat-info">
                                    <p className="stat-label">الرسائل المرسلة</p>
                                    <p className="stat-value">{stats.totalMessagesSent}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">👥</div>
                                <div className="stat-info">
                                    <p className="stat-label">المحادثات النشطة</p>
                                    <p className="stat-value">{stats.activeConversations}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">📅</div>
                                <div className="stat-info">
                                    <p className="stat-label">آخر رسالة</p>
                                    <p className="stat-value">
                                        {stats.lastMessageDate
                                            ? formatDate(stats.lastMessageDate).split(' ')[0]
                                            : 'لا يوجد'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Extended Stats */}
                        <div className="stats-grid" style={{marginTop: '20px'}}>
                            <div className="stat-card">
                                <div className="stat-icon">👍</div>
                                <div className="stat-info">
                                    <p className="stat-label">لايكات أُرسلت</p>
                                    <p className="stat-value">{stats.likesGiven || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">👎</div>
                                <div className="stat-info">
                                    <p className="stat-label">ديسلايك</p>
                                    <p className="stat-value">{stats.dislikesGiven || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">⭐</div>
                                <div className="stat-info">
                                    <p className="stat-label">سوبر لايك</p>
                                    <p className="stat-value">{stats.superlikesGiven || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">❤️</div>
                                <div className="stat-info">
                                    <p className="stat-label">لايكات مُستقبلة</p>
                                    <p className="stat-value">{stats.likesReceived || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">👁️</div>
                                <div className="stat-info">
                                    <p className="stat-label">زوار البروفايل</p>
                                    <p className="stat-value">{stats.profileViewsReceived || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">🚨</div>
                                <div className="stat-info">
                                    <p className="stat-label">بلاغات عليه</p>
                                    <p className="stat-value">{stats.reportsReceived || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">📢</div>
                                <div className="stat-info">
                                    <p className="stat-label">بلاغات أرسلها</p>
                                    <p className="stat-value">{stats.reportsSent || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">🤖</div>
                                <div className="stat-info">
                                    <p className="stat-label">بلاغات سبام</p>
                                    <p className="stat-value">{stats.spamReportsCount || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">👥</div>
                                <div className="stat-info">
                                    <p className="stat-label">الأصدقاء</p>
                                    <p className="stat-value">{stats.friendsCount || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-icon">📤</div>
                                <div className="stat-info">
                                    <p className="stat-label">طلبات صداقة معلقة (أرسلها)</p>
                                    <p className="stat-value">{stats.friendRequestsSent || 0}</p>
                                </div>
                            </div>
                            <div className="stat-card" style={(stats.friendRequestsSentToday || 0) >= 8 ? {border: '1px solid #dc2626', background: '#fef2f2'} : undefined}>
                                <div className="stat-icon">⚡</div>
                                <div className="stat-info">
                                    <p className="stat-label">طلبات صداقة اليوم{(stats.friendRequestsSentToday || 0) >= 8 ? ' ⚠️' : ''}</p>
                                    <p className="stat-value">{stats.friendRequestsSentToday || 0}</p>
                                </div>
                            </div>
                        </div>

                        {/* Additional Stats */}
                        <div className="additional-stats">
                            <div className="stat-row">
                                <span className="stat-row-label">🚫 المستخدمين المحظورين:</span>
                                <span className="stat-row-value">{user.blockedUsers?.length || 0}</span>
                            </div>
                            <div className="stat-row">
                                <span className="stat-row-label">🔇 المحادثات المكتومة:</span>
                                <span className="stat-row-value">{user.mutedConversations?.length || 0}</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Conversations Tab */}
                {activeTab === 'conversations' && (
                    <div className="conversations-section">
                        <h3>💬 المحادثات ({conversations.length})</h3>
                        <div className="conv-filters">
                            <button className={convFilter === 'all' ? 'active' : ''} onClick={() => setConvFilter('all')}>الكل</button>
                            <button className={convFilter === 'active' ? 'active' : ''} onClick={() => setConvFilter('active')}>🟢 نشطة</button>
                            <button className={convFilter === 'closed' ? 'active' : ''} onClick={() => setConvFilter('closed')}>🔴 مغلقة</button>
                        </div>
                        {conversations.length === 0 ? (
                            <p className="empty-message">لا توجد محادثات لهذا المستخدم</p>
                        ) : (
                            <div className="conversations-list">
                                {[...conversations]
                                    .filter(c => convFilter === 'all' ? true : convFilter === 'active' ? c.isActive : !c.isActive)
                                    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
                                    .map((conv) => (
                                    <div key={conv._id} className="conversation-item clickable">
                                        <div className="conversation-header">
                                            <h4>{conv.title}</h4>
                                            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                                <span className={`conv-type ${conv.type}`}>
                                                    {conv.type === 'private' ? 'خاصة' : 'جماعية'}
                                                </span>
                                                {conv.violationsCount > 0 && (
                                                    <span style={{background:'var(--tint-danger)',color: 'var(--text-danger)',padding:'2px 8px',borderRadius:10,fontSize:11,fontWeight:700}} title="عدد المخالفات في هذه المحادثة">
                                                        ⚠️ {conv.violationsCount} مخالفة
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="conversation-meta">
                                            <p>👥 {conv.metadata.totalParticipants} مشارك</p>
                                            <p>📨 {conv.metadata.totalMessages} رسالة</p>
                                            <p className={conv.isActive ? 'active' : 'inactive'}>
                                                {conv.isActive ? '● نشطة' : '○ غير نشطة'}
                                            </p>
                                        </div>

                                        {/* المشاركون — قابلين للنقر */}
                                        {conv.participants?.length > 0 && (
                                            <div style={{marginTop:8,display:'flex',gap:6,flexWrap:'wrap'}}>
                                                {conv.participants.map(p => (
                                                    <button
                                                        key={p._id}
                                                        onClick={() => p._id !== userId && onNavigateToUser && onNavigateToUser(p._id)}
                                                        disabled={p._id === userId}
                                                        style={{
                                                            display:'flex',
                                                            alignItems:'center',
                                                            gap:6,
                                                            padding:'4px 10px',
                                                            background: p._id === userId ? '#e5e7eb' : '#eef2ff',
                                                            border: p._id === userId ? 'none' : '1px solid #6366f1',
                                                            borderRadius:20,
                                                            fontSize:12,
                                                            cursor: p._id === userId ? 'default' : 'pointer',
                                                            color: p._id === userId ? '#6b7280' : '#4338ca'
                                                        }}
                                                    >
                                                        <img
                                                            src={getImageUrl(p.profileImage) || getDefaultAvatar(p.name)}
                                                            alt=""
                                                            style={{width:20,height:20,borderRadius:'50%'}}
                                                            onError={e=>{e.target.src=getDefaultAvatar(p.name)}}
                                                        />
                                                        <span>{p.name}{p._id === userId ? ' (هذا المستخدم)' : ''}</span>
                                                        {p.isOnline && <span style={{width:8,height:8,borderRadius:'50%',background:'#10b981'}}/>}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        <p className="conversation-date" style={{marginTop:8}}>
                                            آخر تحديث: {formatDate(conv.updatedAt)}
                                        </p>
                                        <div className="conversation-actions-row">
                                            <button
                                                className="conv-action-btn view-detail"
                                                onClick={() => setViewingConversationId(conv._id)}
                                            >
                                                👁️ التفاصيل
                                            </button>
                                            <button
                                                className="conv-action-btn view-messages"
                                                onClick={() => {
                                                    setViewingConversationId(conv._id);
                                                    setViewingConversationMessages(true);
                                                }}
                                            >
                                                💬 الرسائل
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Messages Tab */}
                {activeTab === 'messages' && (
                    <div className="messages-section">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,marginBottom:16}}>
                            <h3 style={{margin:0}}>📨 آخر الرسائل ({recentMessages.length})</h3>
                            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                {/* تشفير رسائل هذا المستخدم فقط */}
                                <button
                                    onClick={() => handleCensorMessages('sent')}
                                    disabled={actionLoading || !conversations?.length}
                                    style={{
                                        padding:'8px 14px',
                                        background:'var(--tint-warning)',
                                        border:'1px solid #f59e0b',
                                        color: 'var(--text-warning)',
                                        borderRadius:10,
                                        fontSize:13,
                                        fontWeight:600,
                                        cursor: (actionLoading || !conversations?.length) ? 'not-allowed' : 'pointer',
                                        opacity: (actionLoading || !conversations?.length) ? 0.5 : 1
                                    }}
                                    title="استبدال نص رسائل هذا المستخدم بـ *** (يبقى السجل لكن المحتوى مخفي)"
                                >
                                    *** تشفير رسائله
                                </button>

                                {/* تشفير كل الرسائل في كل المحادثات */}
                                <button
                                    onClick={() => handleCensorMessages('all')}
                                    disabled={actionLoading || !conversations?.length}
                                    style={{
                                        padding:'8px 14px',
                                        background:'#fde68a',
                                        border:'1px solid #d97706',
                                        color:'#78350f',
                                        borderRadius:10,
                                        fontSize:13,
                                        fontWeight:600,
                                        cursor: (actionLoading || !conversations?.length) ? 'not-allowed' : 'pointer',
                                        opacity: (actionLoading || !conversations?.length) ? 0.5 : 1
                                    }}
                                    title="تشفير كل رسائل جميع محادثاته (من الطرفين) — يظهر فوراً في التطبيق"
                                >
                                    ****** تشفير كل المحادثات
                                </button>

                                {/* إخفاء المحادثات من التطبيق (hiddenFor — تبقى في DB للمراجعة) */}
                                <button
                                    onClick={handleDeleteAllConversations}
                                    disabled={actionLoading || !conversations?.length}
                                    style={{
                                        padding:'8px 14px',
                                        background:'var(--tint-danger)',
                                        border:'1px solid #ef4444',
                                        color: 'var(--text-danger)',
                                        borderRadius:10,
                                        fontSize:13,
                                        fontWeight:600,
                                        cursor: (actionLoading || !conversations?.length) ? 'not-allowed' : 'pointer',
                                        opacity: (actionLoading || !conversations?.length) ? 0.5 : 1
                                    }}
                                    title="إخفاء جميع المحادثات من تطبيق المستخدم (تبقى محفوظة في الأرشيف للمراجعة)"
                                >
                                    🗑️ إخفاء كل المحادثات ({conversations?.length || 0})
                                </button>
                            </div>
                        </div>

                        {recentMessages.length === 0 ? (
                            <p className="empty-message">لا توجد رسائل حديثة</p>
                        ) : (
                            <div className="messages-list">
                                {recentMessages.map((msg) => (
                                    <div
                                        key={msg._id}
                                        className="message-item enhanced"
                                        style={{cursor: msg.conversation ? 'pointer' : 'default', transition:'all 0.15s'}}
                                        onClick={() => {
                                            if (msg.conversation) {
                                                setViewingConversationId(msg.conversation);
                                                setViewingConversationMessages(true);
                                            }
                                        }}
                                        onMouseEnter={e => { if (msg.conversation) e.currentTarget.style.background='#f3f4f6'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background=''; }}
                                    >
                                        <div className="message-header">
                                            <span className={`message-type ${msg.type}`}>
                                                {msg.type === 'text' && '📝 نص'}
                                                {msg.type === 'image' && '🖼️ صورة'}
                                                {msg.type === 'file' && '📎 ملف'}
                                                {msg.type === 'audio' && '🎵 صوت'}
                                                {msg.type === 'video' && '🎥 فيديو'}
                                            </span>
                                            <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                                <span className={`message-status ${msg.status}`}>
                                                    {msg.status === 'read' && '✓✓ مقروءة'}
                                                    {msg.status === 'delivered' && '✓ مُوصلة'}
                                                    {msg.status === 'sent' && '○ مرسلة'}
                                                </span>
                                                {msg.isDeleted && <span style={{fontSize:11,color:'#ef4444'}}>❌ محذوفة</span>}
                                                {msg.isCensored && <span style={{fontSize:11,color:'#d97706',background:'#fef3c7',padding:'2px 6px',borderRadius:6}}>*** مشفّرة</span>}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDeleteSingleMessage(msg._id); }}
                                                    disabled={msg.isDeleted}
                                                    title="حذف هذه الرسالة"
                                                    style={{
                                                        padding:'2px 8px',
                                                        fontSize:11,
                                                        background:'transparent',
                                                        border:'1px solid #ef4444',
                                                        color:'#ef4444',
                                                        borderRadius:6,
                                                        cursor: msg.isDeleted ? 'not-allowed' : 'pointer',
                                                        opacity: msg.isDeleted ? 0.4 : 1
                                                    }}
                                                >🗑️</button>
                                            </div>
                                        </div>
                                        {msg.content && <p className="message-content">{msg.content}</p>}
                                        {msg.type === 'image' && (() => {
                                            // ✅ الصورة المؤقتة المنتهية تُعرض من أرشيف الإشراف
                                            const src = getMessagePhotoUrl(msg);
                                            if (!src) {
                                                return msg.isDisappearingPhoto
                                                    ? <p style={{fontSize:12,opacity:0.7}}>⏱️ صورة مؤقتة — غير متوفرة</p>
                                                    : null;
                                            }
                                            return (
                                                <div className="message-media">
                                                    {msg.isExpiredPhoto && (
                                                        <p style={{fontSize:11,color:'#7c3aed',fontWeight:700,margin:'4px 0'}}>⏱️ صورة مؤقتة منتهية — أرشيف الإشراف</p>
                                                    )}
                                                    <img
                                                        src={src}
                                                        alt="صورة"
                                                        className="message-image-preview"
                                                        onClick={(e) => { e.stopPropagation(); setLightboxImage(src); }}
                                                        style={{cursor:'zoom-in'}}
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                </div>
                                            );
                                        })()}
                                        <p className="message-date" style={{marginTop:6,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11,color: 'var(--text-secondary)'}}>
                                            <span>{formatDate(msg.createdAt)}</span>
                                            {msg.conversation && <span style={{color:'#6366f1'}}>اضغط لفتح المحادثة →</span>}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Photos Tab */}
                {activeTab === 'photos' && (
                    <div className="photos-section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <h3 style={{ margin: 0 }}>🖼️ صور المستخدم</h3>
                            <button
                                onClick={() => { setPhotoUploadForm({ file: null, preview: null, reason: '', notify: true }); setShowPhotoUploadModal(true); }}
                                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: 'var(--text-on-brand)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                                title="رفع/استبدال الصورة الشخصية وإشعار المستخدم"
                            >
                                {user.profileImage ? '🔄 استبدال الصورة الشخصية' : '⬆️ رفع صورة شخصية'}
                            </button>
                        </div>

                        {/* Profile Image */}
                        {user.profileImage && (
                            <div className="photos-group">
                                <h4>صورة الملف الشخصي</h4>
                                <div className="photos-grid">
                                    <div className="photo-card">
                                        <img
                                            src={getImageUrl(user.profileImage)}
                                            alt="صورة الملف الشخصي"
                                            className="photo-thumb"
                                            onClick={() => setLightboxImage(getImageUrl(user.profileImage))}
                                            onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
                                        />
                                        <div className="photo-actions">
                                            <button className="photo-view-btn" onClick={() => setLightboxImage(getImageUrl(user.profileImage))}>🔍 عرض</button>
                                            <button className="photo-view-btn" onClick={() => { setPhotoUploadForm({ file: null, preview: null, reason: '', notify: true }); setShowPhotoUploadModal(true); }}>🔄 استبدال</button>
                                            <button className="photo-delete-btn" onClick={() => { setPhotoDeleteForm({ photoIndex: 'profile', reason: '' }); setShowPhotoDeleteModal(true); }}>🗑️ حذف</button>
                                        </div>
                                        <span className="photo-label">الرئيسية</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Additional Photos */}
                        {user.photos && user.photos.length > 0 && (
                            <div className="photos-group">
                                <h4>الصور الإضافية ({user.photos.length})</h4>
                                <div className="photos-grid">
                                    {user.photos.map((photo, idx) => (
                                        <div key={idx} className="photo-card">
                                            <img
                                                src={getImageUrl(photo.original || photo.medium || photo.thumbnail)}
                                                alt={`صورة ${idx + 1}`}
                                                className="photo-thumb"
                                                onClick={() => setLightboxImage(getImageUrl(photo.original || photo.medium))}
                                                onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(user.name); }}
                                            />
                                            <div className="photo-actions">
                                                <button className="photo-view-btn" onClick={() => setLightboxImage(getImageUrl(photo.original || photo.medium))}>🔍 عرض</button>
                                                <button className="photo-delete-btn" onClick={() => { setPhotoDeleteForm({ photoIndex: idx, reason: '' }); setShowPhotoDeleteModal(true); }}>🗑️ حذف</button>
                                            </div>
                                            <span className="photo-label">صورة {idx + 1}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!user.profileImage && (!user.photos || user.photos.length === 0) && (
                            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>لا توجد صور لهذا المستخدم</p>
                        )}

                        {/* 🕓 سجل الصور السابقة — الدليل حين ينكر المستخدم صورته */}
                        <div className="photos-group photo-history-group">
                            <div className="photo-history-head">
                                <h4>🕓 سجل الصور السابقة {photoHistory ? `(${photoHistory.total})` : ''}</h4>
                                <button className="btn-secondary" onClick={fetchPhotoHistory}>🔄 تحديث</button>
                            </div>

                            {photoHistory?.current?.since && (
                                <p className="photo-history-current">
                                    الصورة الحالية منذ: {formatDate(photoHistory.current.since)}
                                </p>
                            )}

                            {photoHistoryLoading && <p className="photo-history-loading">جاري التحميل...</p>}

                            {!photoHistoryLoading && photoHistory && photoHistory.total === 0 && (
                                <p className="photo-history-empty">
                                    لم يغيّر هذا المستخدم صورته منذ تفعيل السجل
                                </p>
                            )}

                            {!photoHistoryLoading && photoHistory && photoHistory.total > 0 && (
                                <div className="photos-grid">
                                    {photoHistory.history.map((entry, idx) => (
                                        <div key={idx} className="photo-card photo-history-card">
                                            {entry.purged || !entry.fileName ? (
                                                <div className="photo-history-purged">
                                                    🗑️<br />الملف لم يُحفظ
                                                </div>
                                            ) : photoBlobs[idx] === false ? (
                                                <div className="photo-history-purged">
                                                    ⚠️<br />تعذّر تحميل الصورة
                                                </div>
                                            ) : photoBlobs[idx] ? (
                                                <img
                                                    src={photoBlobs[idx]}
                                                    alt={`صورة سابقة ${idx + 1}`}
                                                    className="photo-thumb"
                                                    onClick={() => setLightboxImage(photoBlobs[idx])}
                                                />
                                            ) : (
                                                <div className="photo-history-loading-box">جاري التحميل...</div>
                                            )}

                                            <div className="photo-history-meta">
                                                <span className={`photo-history-reason reason-${entry.reason}`}>
                                                    {PHOTO_HISTORY_REASONS[entry.reason] || entry.reason}
                                                </span>
                                                <span className="photo-history-date">{formatDate(entry.replacedAt)}</span>
                                                {entry.by?.name && (
                                                    <span className="photo-history-by">بواسطة: {entry.by.name}</span>
                                                )}
                                                {entry.inViolations && (
                                                    <span className="photo-history-flag">⚠️ دليل مخالفة</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Timeline Tab */}
                {activeTab === 'timeline' && (
                    <div className="timeline-section">
                        <h3>📜 سجل الأحداث</h3>
                        {(() => {
                            const events = buildTimelineEvents();
                            if (events.length === 0) {
                                return <p className="empty-message">لا توجد أحداث مسجلة</p>;
                            }
                            return (
                                <div className="timeline-list">
                                    {events.map((event, idx) => (
                                        <div key={idx} className={`timeline-item timeline-${event.color}`}>
                                            <div className="timeline-dot-wrapper">
                                                <span className={`timeline-dot dot-${event.color}`}></span>
                                                {idx < events.length - 1 && <span className="timeline-line"></span>}
                                            </div>
                                            <div className="timeline-content">
                                                <div className="timeline-header-row">
                                                    <span className="timeline-icon">{event.icon}</span>
                                                    <span className="timeline-text">{event.text}</span>
                                                </div>
                                                {event.detail && <p className="timeline-detail">{event.detail}</p>}
                                                <span className="timeline-date">{event.date ? new Date(event.date).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* 🚩 Reports Tab */}
                {activeTab === 'reports' && (
                    <div className="reports-tab-section">
                        <div className="reports-tab-header">
                            <h3>🚩 بلاغات المستخدم</h3>
                            <button className="btn-secondary" onClick={fetchUserReports}>🔄 تحديث</button>
                        </div>

                        <div className="reports-direction-switch">
                            <button
                                className={`rd-btn ${reportsDirection === 'against' ? 'active' : ''}`}
                                onClick={() => setReportsDirection('against')}
                            >
                                ⚠️ بلاغات ضدّه ({reportsData?.totals?.against ?? 0})
                            </button>
                            <button
                                className={`rd-btn ${reportsDirection === 'by' ? 'active' : ''}`}
                                onClick={() => setReportsDirection('by')}
                            >
                                📤 بلاغات قدّمها ({reportsData?.totals?.by ?? 0})
                            </button>
                        </div>

                        {reportsLoading && <div className="reports-tab-loading">جاري التحميل...</div>}

                        {!reportsLoading && reportsData && (() => {
                            const list = reportsDirection === 'against' ? (reportsData.against || []) : (reportsData.by || []);
                            if (list.length === 0) {
                                return (
                                    <div className="reports-tab-empty">
                                        {reportsDirection === 'against'
                                            ? '✨ لا توجد بلاغات ضدّ هذا المستخدم'
                                            : 'لم يُقدّم هذا المستخدم أي بلاغ'}
                                    </div>
                                );
                            }
                            return (
                                <div className="reports-tab-list">
                                    {list.map(r => {
                                        const other = reportsDirection === 'against' ? r.reportedBy : r.reportedUser;
                                        return (
                                            <div key={r._id} className={`report-tab-card status-${r.status}`}>
                                                <div className="report-tab-top">
                                                    <div className="report-tab-badges">
                                                        <span className="report-cat-badge">{REPORT_CATEGORIES[r.category] || r.category}</span>
                                                        <span className={`report-status-badge st-${r.status}`}>
                                                            {REPORT_STATUSES[r.status] || r.status}
                                                        </span>
                                                        {r.action && r.action !== 'none' && (
                                                            <span className="report-action-badge">
                                                                {REPORT_ACTIONS[r.action] || r.action}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="report-tab-date">{formatDate(r.createdAt)}</span>
                                                </div>

                                                {other && (
                                                    <div
                                                        className="report-tab-party"
                                                        onClick={() => onNavigateToUser && onNavigateToUser(other._id)}
                                                        title="فتح ملف المستخدم"
                                                    >
                                                        <img
                                                            src={other.profileImage ? getImageUrl(other.profileImage) : getDefaultAvatar(other.name)}
                                                            alt=""
                                                            onError={(e) => { e.target.onerror = null; e.target.src = getDefaultAvatar(other.name); }}
                                                        />
                                                        <span className="report-party-label">
                                                            {reportsDirection === 'against' ? 'المُبلِّغ:' : 'المُبلَّغ عنه:'}
                                                        </span>
                                                        <span className="report-party-name">{other.name}</span>
                                                        {other.halaId && <span className="report-party-id">#{other.halaId}</span>}
                                                    </div>
                                                )}

                                                {r.description && (
                                                    <p className="report-tab-desc">{r.description}</p>
                                                )}

                                                {r.screenshot && (
                                                    <div className="report-tab-shot">
                                                        <span className="report-shot-label">📸 لقطة الدليل:</span>
                                                        <img
                                                            src={getImageUrl(r.screenshot)}
                                                            alt="لقطة البلاغ"
                                                            onClick={() => setLightboxImage(getImageUrl(r.screenshot))}
                                                        />
                                                    </div>
                                                )}

                                                {r.reviewNotes && (
                                                    <div className="report-tab-notes">📝 {r.reviewNotes}</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* ⚠️ Violations Tab */}
                {activeTab === 'violations' && (
                    <div className="violations-section">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
                            <h3 style={{margin:0}}>⚠️ سجل المخالفات ({violationsList.length})</h3>
                            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                <select value={violationsFilter} onChange={e=>setViolationsFilter(e.target.value)} style={{padding:'6px 10px',borderRadius:8,border: '1px solid var(--border-color)'}}>
                                    <option value="">كل الأنواع</option>
                                    <option value="banned_word">كلمات محظورة</option>
                                    <option value="photo">صور مخالفة</option>
                                    <option value="name">اسم مخالف</option>
                                    <option value="bio">نبذة مخالفة</option>
                                    <option value="behavior">سلوك مزعج</option>
                                    <option value="inappropriate">محتوى غير لائق</option>
                                    <option value="spam">سبام</option>
                                    <option value="report">بلاغ</option>
                                    <option value="other">أخرى</option>
                                </select>
                                <button className="btn-secondary" onClick={fetchViolations}>🔄 تحديث</button>
                            </div>
                        </div>

                        {violationsLoading && <div style={{padding:20,textAlign:'center'}}>جاري التحميل...</div>}

                        {!violationsLoading && violationsList.length === 0 && (
                            <div style={{padding:40,textAlign:'center',color: 'var(--text-secondary)',background: 'var(--bg-subtle)',borderRadius:12,marginTop:16}}>
                                ✨ لا توجد مخالفات مسجّلة لهذا المستخدم
                            </div>
                        )}

                        {!violationsLoading && violationsList.length > 0 && (
                            <div style={{display:'flex',flexDirection:'column',gap:12,marginTop:16}}>
                                {violationsList
                                    .filter(v => !violationsFilter || v.type === violationsFilter)
                                    .map(v => {
                                        const typeLabels = {
                                            banned_word: { label: 'كلمة محظورة', color: '#ef4444', icon: '🚫' },
                                            photo: { label: 'صورة مخالفة', color: '#f59e0b', icon: '🖼️' },
                                            name: { label: 'اسم مخالف', color: '#8b5cf6', icon: '📝' },
                                            bio: { label: 'نبذة مخالفة', color: '#06b6d4', icon: '📋' },
                                            behavior: { label: 'سلوك مزعج', color: '#f97316', icon: '⚠️' },
                                            inappropriate: { label: 'محتوى غير لائق', color: '#dc2626', icon: '🚫' },
                                            spam: { label: 'سبام', color: '#a855f7', icon: '📢' },
                                            report: { label: 'بلاغ', color: '#3b82f6', icon: '🚩' },
                                            other: { label: 'أخرى', color: 'var(--text-secondary)', icon: '📌' }
                                        };
                                        const tl = typeLabels[v.type] || typeLabels.other;
                                        return (
                                            <div key={v._id} style={{border:`1px solid ${tl.color}30`,borderRadius:12,padding:14,background:`${tl.color}08`}}>
                                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:10,flexWrap:'wrap'}}>
                                                    <div>
                                                        <span style={{background:tl.color,color: 'var(--text-on-brand)',padding:'3px 10px',borderRadius:20,fontSize:12,fontWeight:600}}>
                                                            {tl.icon} {tl.label}
                                                        </span>
                                                        {v.action && v.action !== 'none' && (
                                                            <span style={{marginRight:8,background: 'var(--bg-subtle)',padding:'3px 10px',borderRadius:20,fontSize:12,color: 'var(--text-primary)'}}>
                                                                {v.action === 'warning' && '⚠️ تحذير'}
                                                                {v.action === 'restricted' && '🔒 تقييد'}
                                                                {v.action === 'suspended' && '⛔ إيقاف'}
                                                                {v.action === 'banned' && '🚫 حظر'}
                                                                {v.action === 'photo_removed' && '🗑️ حذف صورة'}
                                                                {v.action === 'name_reset' && '🔄 إعادة الاسم'}
                                                                {v.action === 'bio_reset' && '🔄 إعادة النبذة'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span style={{fontSize:12,color: 'var(--text-secondary)'}}>{formatDate(v.createdAt)}</span>
                                                </div>

                                                {v.reason && <div style={{marginTop:10,color: 'var(--text-primary)'}}><strong>السبب:</strong> {v.reason}</div>}

                                                {/* الدليل */}
                                                {v.evidence?.kind === 'message' && v.evidence.text && (
                                                    <div style={{marginTop:10,padding:10,background: 'var(--bg-card)',borderRadius:8,border: '1px solid var(--border-color)'}}>
                                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4,flexWrap:'wrap',gap:6}}>
                                                            <div style={{fontSize:11,color: 'var(--text-secondary)'}}>📎 الدليل (رسالة):</div>
                                                            {v.evidence.conversationId && onViewConversation && (
                                                                <button
                                                                    onClick={() => onViewConversation(v.evidence.conversationId)}
                                                                    style={{
                                                                        background:'#6366f1',color: 'var(--text-on-brand)',border:'none',
                                                                        padding:'4px 10px',borderRadius:6,fontSize:11,
                                                                        fontWeight:700,cursor:'pointer'
                                                                    }}
                                                                    title="فتح المحادثة كاملة لرؤية السياق"
                                                                >
                                                                    💬 عرض المحادثة
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div style={{color:'#b91c1c',fontWeight:500,direction:'rtl'}}>{v.evidence.text}</div>
                                                        {v.evidence.metadata?.matchedWords && (
                                                            <div style={{marginTop:6,fontSize:11,color: 'var(--text-secondary)'}}>
                                                                الكلمات المرصودة: {v.evidence.metadata.matchedWords.join('، ')}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {v.evidence?.kind === 'name' && v.evidence.text && (
                                                    <div style={{marginTop:10,padding:10,background: 'var(--bg-card)',borderRadius:8,border: '1px solid var(--border-color)'}}>
                                                        <div style={{fontSize:11,color: 'var(--text-secondary)',marginBottom:4}}>📎 الاسم الأصلي (دليل):</div>
                                                        <div style={{color:'#7c3aed',fontWeight:600}}>{v.evidence.text}</div>
                                                    </div>
                                                )}
                                                {v.evidence?.kind === 'bio' && v.evidence.text && (
                                                    <div style={{marginTop:10,padding:10,background: 'var(--bg-card)',borderRadius:8,border: '1px solid var(--border-color)'}}>
                                                        <div style={{fontSize:11,color: 'var(--text-secondary)',marginBottom:4}}>📎 النبذة الأصلية (دليل):</div>
                                                        <div style={{color:'#0e7490',direction:'rtl'}}>{v.evidence.text}</div>
                                                    </div>
                                                )}
                                                {v.evidence?.kind === 'photo' && v.evidence.photoPath && (
                                                    <div style={{marginTop:10,padding:10,background: 'var(--bg-card)',borderRadius:8,border: '1px solid var(--border-color)'}}>
                                                        <div style={{fontSize:11,color: 'var(--text-secondary)',marginBottom:6}}>📎 الصورة الأصلية (دليل محمي):</div>
                                                        {evidenceBlobs[v._id] ? (
                                                            <img
                                                                src={evidenceBlobs[v._id]}
                                                                alt="دليل"
                                                                style={{maxWidth:200,maxHeight:200,borderRadius:8,cursor:'pointer',border:'2px solid #f59e0b'}}
                                                                onClick={() => setLightboxImage(evidenceBlobs[v._id])}
                                                            />
                                                        ) : (
                                                            <div style={{padding:20,background: 'var(--bg-subtle)',borderRadius:8,textAlign:'center',color: 'var(--text-muted)',fontSize:12}}>
                                                                جاري تحميل الصورة...
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                {/* البلاغ المرتبط + لقطته — كانت مخالفات «بلاغ» بلا دليل بصري */}
                                                {v.evidence?.reportId && typeof v.evidence.reportId === 'object' && (
                                                    <div className="violation-report-box">
                                                        <div className="violation-report-head">
                                                            <span>🚩 البلاغ المرتبط</span>
                                                            <span className="violation-report-cat">
                                                                {REPORT_CATEGORIES[v.evidence.reportId.category] || v.evidence.reportId.category}
                                                            </span>
                                                        </div>
                                                        {v.evidence.reportId.reportedBy?.name && (
                                                            <div className="violation-report-by">
                                                                المُبلِّغ: {v.evidence.reportId.reportedBy.name}
                                                                {v.evidence.reportId.reportedBy.halaId ? ` #${v.evidence.reportId.reportedBy.halaId}` : ''}
                                                            </div>
                                                        )}
                                                        {v.evidence.reportId.description && (
                                                            <div className="violation-report-desc">{v.evidence.reportId.description}</div>
                                                        )}
                                                        {v.evidence.reportId.screenshot ? (
                                                            <img
                                                                src={getImageUrl(v.evidence.reportId.screenshot)}
                                                                alt="لقطة البلاغ"
                                                                className="violation-report-shot"
                                                                onClick={() => setLightboxImage(getImageUrl(v.evidence.reportId.screenshot))}
                                                                title="اضغط للتكبير"
                                                            />
                                                        ) : (
                                                            <div className="violation-report-noshot">لم يرفق المُبلِّغ لقطة</div>
                                                        )}
                                                    </div>
                                                )}
                                                {v.evidence?.kind === 'text' && v.evidence.text && v.type === 'other' && (
                                                    <div style={{marginTop:10,padding:10,background: 'var(--bg-card)',borderRadius:8,border: '1px solid var(--border-color)',fontSize:13,color: 'var(--text-primary)'}}>
                                                        {v.evidence.text}
                                                    </div>
                                                )}

                                                <div style={{marginTop:10,display:'flex',gap:10,fontSize:11,color: 'var(--text-secondary)',flexWrap:'wrap'}}>
                                                    <span>المصدر: {({auto:'تلقائي',admin:'أدمن',user_report:'بلاغ',banned_words_filter:'فلتر كلمات',spam_filter:'فلتر سبام'})[v.source] || v.source}</span>
                                                    {v.admin?.name && <span>بواسطة: {v.admin.name}</span>}
                                                    {v.escalationLevel > 0 && <span>المستوى: {v.escalationLevel}</span>}
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>
                )}

                {/* 👥 Related Accounts Tab */}
                {activeTab === 'related' && (
                    <div className="related-section">
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
                            <h3 style={{margin:0}}>👥 الحسابات المرتبطة</h3>
                            <button className="btn-secondary" onClick={fetchRelatedAccounts}>🔄 تحديث</button>
                        </div>

                        {relatedLoading && <div style={{padding:20,textAlign:'center'}}>جاري البحث...</div>}

                        {!relatedLoading && relatedAccounts && (
                            <>
                                {/* تحذير البصمة */}
                                {!relatedAccounts.hasFingerprint && !relatedAccounts.hasKeychain && (
                                    <div style={{marginTop:16,padding:14,background:'var(--tint-warning)',border:'1px solid #f59e0b',borderRadius:12,color: 'var(--text-warning)'}}>
                                        ⚠️ <strong>لا توجد بصمة جهاز لهذا المستخدم</strong> — لم يسجل دخول من التطبيق المحدّث.
                                        <div style={{fontSize:12,marginTop:4,color:'#92400e'}}>سيتم تحديث البصمة تلقائياً عند فتح المستخدم للتطبيق المحدّث.</div>
                                    </div>
                                )}

                                {/* ⚠️ تحذير بصمة ضوضائية */}
                                {relatedAccounts.noise?.fingerprintNoisy && (
                                    <div style={{marginTop:12,padding:14,background:'var(--tint-danger)',border:'1px solid #ef4444',borderRadius:12,color: 'var(--text-danger)'}}>
                                        🚫 <strong>بصمة الجهاز ضوضائية (collision)</strong> — تطابق {relatedAccounts.noise.fingerprintMatchCount} حساب في النظام (الحد: {relatedAccounts.noise.threshold}).
                                        <div style={{fontSize:12,marginTop:4,color:'#991b1b'}}>
                                            لم نُدرج المطابقات بناءً على هذه البصمة لتجنب false positives (iOS Simulator / fallback hash).
                                        </div>
                                    </div>
                                )}
                                {relatedAccounts.noise?.keychainNoisy && (
                                    <div style={{marginTop:12,padding:14,background:'var(--tint-danger)',border:'1px solid #ef4444',borderRadius:12,color: 'var(--text-danger)'}}>
                                        🚫 <strong>Keychain Token ضوضائي (collision)</strong> — يطابق {relatedAccounts.noise.keychainMatchCount} حساب (الحد: {relatedAccounts.noise.threshold}).
                                        <div style={{fontSize:12,marginTop:4,color:'#991b1b'}}>
                                            لم نُدرج المطابقات بناءً على هذا التوكن لتجنب false positives (iCloud Keychain مشترك).
                                        </div>
                                    </div>
                                )}

                                {/* ملخص */}
                                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginTop:16}}>
                                    <div style={{padding:14,background:'#eff6ff',borderRadius:12,border:'1px solid #bfdbfe'}}>
                                        <div style={{fontSize:12,color:'#1e40af'}}>بصمة الجهاز</div>
                                        <div style={{fontSize:22,fontWeight:700,color:'#1e3a8a'}}>{relatedAccounts.counts.byFingerprint}</div>
                                    </div>
                                    <div style={{padding:14,background:'#fdf4ff',borderRadius:12,border:'1px solid #f0abfc'}}>
                                        <div style={{fontSize:12,color:'#86198f'}}>Keychain Token</div>
                                        <div style={{fontSize:22,fontWeight:700,color:'#701a75'}}>{relatedAccounts.counts.byKeychain}</div>
                                    </div>
                                    <div style={{padding:14,background:'#ecfdf5',borderRadius:12,border:'1px solid #a7f3d0'}}>
                                        <div style={{fontSize:12,color:'#065f46'}}>IP مشترك</div>
                                        <div style={{fontSize:22,fontWeight:700,color:'#064e3b'}}>{relatedAccounts.counts.byIP}</div>
                                    </div>
                                    <div style={{padding:14,background:'#fef2f2',borderRadius:12,border:'1px solid #fecaca'}}>
                                        <div style={{fontSize:12,color:'#991b1b'}}>أجهزة محظورة</div>
                                        <div style={{fontSize:22,fontWeight:700,color:'#7f1d1d'}}>{relatedAccounts.counts.byBannedDevice}</div>
                                    </div>
                                </div>

                                {/* حسابات مرتبطة (فريدة - دمج بصمة + keychain) */}
                                {relatedAccounts.uniqueRelated?.length > 0 && (
                                    <div style={{marginTop:20}}>
                                        <h4 style={{marginBottom:12}}>🔗 حسابات مرتبطة بنفس الجهاز ({relatedAccounts.uniqueRelated.length})</h4>
                                        <div style={{display:'flex',flexDirection:'column',gap:10}}>
                                            {relatedAccounts.uniqueRelated.map(u => {
                                                const isBanned = u.bannedWords?.isBanned;
                                                const isSuspended = u.suspension?.isSuspended;
                                                const isDeviceBanned = u.deviceBanned;
                                                const isInactive = !u.isActive;

                                                // أولوية الألوان: بان > تعليق > جهاز محظور > غير مفعّل > عادي
                                                let borderColor = '#e5e7eb';
                                                let bgColor = '#fff';
                                                let hoverBg = '#eef2ff';
                                                let hoverBorder = '#6366f1';

                                                if (isBanned) {
                                                    borderColor = '#ef4444';
                                                    bgColor = '#fef2f2';
                                                    hoverBg = '#fee2e2';
                                                    hoverBorder = '#dc2626';
                                                } else if (isSuspended) {
                                                    borderColor = '#f59e0b';
                                                    bgColor = '#fffbeb';
                                                    hoverBg = '#fef3c7';
                                                    hoverBorder = '#d97706';
                                                } else if (isDeviceBanned) {
                                                    borderColor = '#a855f7';
                                                    bgColor = '#faf5ff';
                                                    hoverBg = '#f3e8ff';
                                                    hoverBorder = '#9333ea';
                                                } else if (isInactive) {
                                                    borderColor = '#d1d5db';
                                                    bgColor = '#f9fafb';
                                                }

                                                return (
                                                    <div
                                                        key={u._id}
                                                        onClick={() => onNavigateToUser && onNavigateToUser(u._id)}
                                                        style={{display:'flex',alignItems:'center',gap:12,padding:12,background:bgColor,border:`2px solid ${borderColor}`,borderRadius:12,cursor:'pointer',transition:'all 0.15s'}}
                                                        onMouseEnter={e=>{e.currentTarget.style.borderColor=hoverBorder;e.currentTarget.style.background=hoverBg;}}
                                                        onMouseLeave={e=>{e.currentTarget.style.borderColor=borderColor;e.currentTarget.style.background=bgColor;}}
                                                    >
                                                        <img src={getImageUrl(u.profileImage) || getDefaultAvatar(u.name)} alt={u.name} style={{width:48,height:48,borderRadius:'50%',objectFit:'cover',opacity: isBanned || isInactive ? 0.7 : 1}} onError={(e)=>{e.target.src=getDefaultAvatar(u.name)}}/>
                                                        <div style={{flex:1}}>
                                                            <div style={{fontWeight:600,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                                                <span style={{textDecoration: isBanned ? 'line-through' : 'none', color: isBanned ? '#991b1b' : 'inherit'}}>{u.name}</span>
                                                                {isBanned && (
                                                                    <span title={u.bannedWords?.banReason || ''} style={{background:'#dc2626',color: 'var(--text-on-brand)',padding:'3px 10px',borderRadius:10,fontSize:11,fontWeight:700}}>🚫 محظور</span>
                                                                )}
                                                                {isSuspended && !isBanned && (
                                                                    <span style={{background:'var(--tint-danger)',color: 'var(--text-danger)',padding:'2px 8px',borderRadius:10,fontSize:11}}>⛔ معلّق</span>
                                                                )}
                                                                {isDeviceBanned && !isBanned && (
                                                                    <span title="هذا المستخدم هو صاحب الجهاز المحظور الأصلي" style={{background:'#f3e8ff',color:'#6b21a8',padding:'2px 8px',borderRadius:10,fontSize:11}}>📵 صاحب جهاز محظور</span>
                                                                )}
                                                                {isInactive && !isBanned && (
                                                                    <span style={{background: 'var(--bg-subtle)',color: 'var(--text-secondary)',padding:'2px 8px',borderRadius:10,fontSize:11}}>غير مفعّل</span>
                                                                )}
                                                            </div>
                                                            <div style={{fontSize:12,color: 'var(--text-secondary)'}}>{u.email} {u.halaId && `• ${u.halaId}`}</div>
                                                            <div style={{fontSize:11,color: 'var(--text-muted)',marginTop:2}}>تسجيل: {formatDate(u.createdAt)}</div>
                                                        </div>
                                                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                                                            {/* أزرار إجراءات سريعة inline */}
                                                            {!isBanned && (
                                                                <>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleQuickSuspendRelated(u._id, u.name); }}
                                                                        title="تعليق سريع 3 أيام"
                                                                        style={{padding:'6px 10px',fontSize:12,background:'var(--tint-warning)',border:'1px solid #f59e0b',borderRadius:8,color: 'var(--text-warning)',cursor:'pointer'}}
                                                                    >⛔ تعليق</button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleQuickBanRelated(u._id, u.name); }}
                                                                        title="حظر نهائي + حظر الجهاز"
                                                                        style={{padding:'6px 10px',fontSize:12,background:'var(--tint-danger)',border:'1px solid #ef4444',borderRadius:8,color: 'var(--text-danger)',cursor:'pointer'}}
                                                                    >🚫 حظر</button>
                                                                </>
                                                            )}
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onNavigateToUser && onNavigateToUser(u._id); }}
                                                                style={{padding:'6px 10px',fontSize:12,background:'#eef2ff',border:'1px solid #6366f1',borderRadius:8,color:'#4338ca',cursor:'pointer'}}
                                                            >فتح →</button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* حسابات بنفس IP */}
                                {relatedAccounts.byIP?.length > 0 && (
                                    <div style={{marginTop:20}}>
                                        <h4 style={{marginBottom:12}}>🌐 نفس عنوان IP ({relatedAccounts.byIP.length})</h4>
                                        <div style={{display:'flex',flexDirection:'column',gap:8}}>
                                            {relatedAccounts.byIP.slice(0,10).map(u => (
                                                <div
                                                    key={u._id}
                                                    onClick={() => onNavigateToUser && onNavigateToUser(u._id)}
                                                    style={{display:'flex',alignItems:'center',gap:10,padding:10,background: 'var(--bg-subtle)',borderRadius:10,fontSize:13,cursor:'pointer'}}
                                                    onMouseEnter={e=>e.currentTarget.style.background='#f3f4f6'}
                                                    onMouseLeave={e=>e.currentTarget.style.background='#f9fafb'}
                                                >
                                                    <img src={getImageUrl(u.profileImage) || getDefaultAvatar(u.name)} alt="" style={{width:32,height:32,borderRadius:'50%'}} onError={(e)=>{e.target.src=getDefaultAvatar(u.name)}}/>
                                                    <span style={{flex:1}}>{u.name} • {u.email}</span>
                                                    <span style={{fontSize:11,color: 'var(--text-secondary)'}}>{formatDate(u.lastLogin)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* أجهزة محظورة مرتبطة */}
                                {relatedAccounts.byBannedDevice?.length > 0 && (
                                    <div style={{marginTop:20,padding:14,background:'#fef2f2',borderRadius:12,border:'1px solid #fecaca'}}>
                                        <h4 style={{marginTop:0,color:'#991b1b'}}>🚫 هذا الجهاز محظور مسبقاً!</h4>
                                        {relatedAccounts.byBannedDevice.map(b => (
                                            <div key={b._id} style={{marginTop:8,fontSize:13,color:'#7f1d1d'}}>
                                                • المستخدم الأصلي: {b.originalUserId?.name || 'محذوف'} — السبب: {b.reason} — {formatDate(b.createdAt)}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {relatedAccounts.uniqueRelated?.length === 0 && relatedAccounts.byIP?.length === 0 && relatedAccounts.byBannedDevice?.length === 0 && (relatedAccounts.hasFingerprint || relatedAccounts.hasKeychain) && (
                                    <div style={{padding:40,textAlign:'center',color: 'var(--text-secondary)',background: 'var(--bg-subtle)',borderRadius:12,marginTop:16}}>
                                        ✅ لم يتم العثور على حسابات مرتبطة لهذا المستخدم
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* 🛡️ Moderation Tools Tab */}
                {activeTab === 'mod-tools' && (
                    <div className="mod-tools-section">
                        <h3 style={{marginTop:0}}>🛡️ أدوات الإشراف — إرسال تنبيه رسمي</h3>
                        <p style={{color: 'var(--text-secondary)',fontSize:13,marginBottom:20}}>
                            التنبيه يظهر للمستخدم كـ <strong>Modal إجباري</strong> داخل التطبيق — لا يُغلق إلا بضغطه "فهمت"، وتُحفظ لحظة التأكيد في السجل.
                        </p>

                        {/* 7 Templates Grid */}
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:24}}>
                            {warningTemplates.map(t => {
                                const colors = {
                                    photo_violation: { bg:'#fef3c7', border:'#f59e0b', text:'#78350f' },
                                    name_violation: { bg:'#e0e7ff', border:'#6366f1', text:'#312e81' },
                                    inappropriate_content: { bg:'#fee2e2', border:'#ef4444', text:'#7f1d1d' },
                                    disruptive_behavior: { bg:'#fff7ed', border:'#f97316', text:'#7c2d12' },
                                    bio_violation: { bg:'#ecfeff', border:'#06b6d4', text:'#164e63' },
                                    external_accounts: { bg:'#ede9fe', border:'#7c3aed', text:'#4c1d95' },
                                    final_warning: { bg:'#fee2e2', border:'#dc2626', text:'#7f1d1d' },
                                    custom: { bg:'#f9fafb', border:'#9ca3af', text:'#374151' }
                                };
                                const c = colors[t.key] || colors.custom;
                                return (
                                    <button
                                        key={t.key}
                                        onClick={() => openWarningModal(t)}
                                        style={{
                                            padding:16,
                                            background:c.bg,
                                            border:`2px ${t.key==='custom'?'dashed':'solid'} ${c.border}`,
                                            borderRadius:14,
                                            textAlign:'right',
                                            cursor:'pointer',
                                            transition:'all 0.15s',
                                            color:c.text
                                        }}
                                        onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
                                        onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}
                                    >
                                        <div style={{fontSize:24,marginBottom:6}}>{t.icon}</div>
                                        <div style={{fontWeight:700,fontSize:15,marginBottom:4}}>{t.label}</div>
                                        <div style={{fontSize:12,opacity:0.8,lineHeight:1.4}}>
                                            {t.key === 'custom' ? 'اكتب عنوان ومحتوى' : (t.body.length > 70 ? t.body.substring(0,70)+'...' : t.body)}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* سجل التنبيهات السابقة */}
                        <div style={{marginTop:30}}>
                            <h4>📋 التنبيهات السابقة ({warningsList.length})</h4>
                            {warningsLoading && <div>جاري التحميل...</div>}
                            {!warningsLoading && warningsList.length === 0 && (
                                <div style={{padding:24,textAlign:'center',color: 'var(--text-secondary)',background: 'var(--bg-subtle)',borderRadius:12}}>
                                    لم يتم إرسال أي تنبيه رسمي لهذا المستخدم
                                </div>
                            )}
                            {!warningsLoading && warningsList.length > 0 && (
                                <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:12}}>
                                    {warningsList.map(w => {
                                        const statusColors = {
                                            active: { bg:'#fef3c7', text:'#92400e', label:'نشط — لم يُقرأ' },
                                            acknowledged: { bg:'#dcfce7', text:'#166534', label:'تم التأكيد ✅' },
                                            dismissed: { bg:'#f3f4f6', text:'#6b7280', label:'مُخفى' },
                                            expired: { bg:'#f3f4f6', text:'#6b7280', label:'منتهي' }
                                        };
                                        const s = statusColors[w.status] || statusColors.active;
                                        return (
                                            <div key={w._id} style={{padding:12,background: 'var(--bg-card)',border: '1px solid var(--border-color)',borderRadius:12}}>
                                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:10,flexWrap:'wrap'}}>
                                                    <div style={{flex:1}}>
                                                        <div style={{fontWeight:700,fontSize:14}}>{w.icon} {w.title}</div>
                                                        <div style={{fontSize:13,color: 'var(--text-secondary)',marginTop:4,lineHeight:1.5}}>{w.body}</div>
                                                    </div>
                                                    <span style={{background:s.bg,color:s.text,padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,whiteSpace:'nowrap'}}>
                                                        {s.label}
                                                    </span>
                                                </div>
                                                <div style={{marginTop:10,display:'flex',gap:10,fontSize:11,color: 'var(--text-secondary)',flexWrap:'wrap',justifyContent:'space-between'}}>
                                                    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                                                        <span>📤 {formatDate(w.sentAt)}</span>
                                                        {w.readAt && <span>👁️ قُرِئ: {formatDate(w.readAt)}</span>}
                                                        {w.acknowledgedAt && <span>✅ أُكِّد: {formatDate(w.acknowledgedAt)}</span>}
                                                    </div>
                                                    {w.status === 'active' && (
                                                        <button
                                                            onClick={() => handleDismissWarning(w._id)}
                                                            style={{background:'transparent',border:'1px solid #ef4444',color:'#ef4444',padding:'3px 10px',borderRadius:8,fontSize:11,cursor:'pointer'}}
                                                        >إخفاء التنبيه</button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Admin Actions Tab */}
                {activeTab === 'admin-actions' && (
                    <div className="admin-actions-section">
                        <h3>⚙️ إجراءات الأدمن</h3>

                        {/* Current Status Overview */}
                        <div className="admin-status-overview">
                            <div className="status-cards-row">
                                <div className={`admin-status-card ${user.suspension?.isSuspended ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">{user.suspension?.isSuspended ? '🔒' : '🔓'}</span>
                                    <div>
                                        <p className="status-card-label">حالة التعليق</p>
                                        <p className="status-card-value">
                                            {user.suspension?.isSuspended
                                                ? `معلّق${user.suspension.suspendedUntil ? ` حتى ${formatDate(user.suspension.suspendedUntil)}` : ' (دائم)'}`
                                                : 'غير معلّق'}
                                        </p>
                                        {user.suspension?.reason && (
                                            <p className="status-card-sub">السبب: {user.suspension.reason}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Suspension Level & Reports */}
                                <div className={`admin-status-card ${(user.suspension?.level || 0) >= 3 ? 'danger' : (user.suspension?.level || 0) >= 1 ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">📊</span>
                                    <div>
                                        <p className="status-card-label">مستوى التعليق</p>
                                        <p className="status-card-value">
                                            المستوى {user.suspension?.level || 0} / 5
                                        </p>
                                        <div className="suspension-level-bar">
                                            {[1,2,3,4,5].map(lvl => (
                                                <div key={lvl} className={`level-dot ${lvl <= (user.suspension?.level || 0) ? 'active' : ''} ${lvl === 5 ? 'permanent' : ''}`}>
                                                    {lvl <= (user.suspension?.level || 0) ? '●' : '○'}
                                                </div>
                                            ))}
                                        </div>
                                        <p className="status-card-sub">
                                            {['', '24 ساعة', '48 ساعة', '3 أيام', '7 أيام', 'دائم'][user.suspension?.level || 0] || 'لا تعليق'}
                                            {' — '}مرات التعليق: {user.suspension?.totalSuspensions || 0}
                                        </p>
                                    </div>
                                </div>

                                {/* Reports Count */}
                                <div className={`admin-status-card ${reportsCount && reportsCount.uniqueReporters >= 5 ? 'danger' : reportsCount && reportsCount.uniqueReporters >= 3 ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">🚨</span>
                                    <div>
                                        <p className="status-card-label">البلاغات</p>
                                        <p className="status-card-value">
                                            {reportsCount ? `${reportsCount.uniqueReporters} / ${reportsCount.autoSuspendThreshold} مبلّغ فريد` : 'جاري التحميل...'}
                                        </p>
                                        {reportsCount && (
                                            <p className="status-card-sub">
                                                إجمالي: {reportsCount.totalReports} — معلّقة: {reportsCount.pendingReports}
                                            </p>
                                        )}
                                        {reportsCount && reportsCount.uniqueReporters >= 5 && !user.suspension?.isSuspended && (
                                            <p className="status-card-sub" style={{color: '#e74c3c', fontWeight: 'bold'}}>
                                                تجاوز الحد — سيُعلّق تلقائياً عند البلاغ القادم
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className={`admin-status-card ${(user.bannedWords?.violations || 0) > 0 ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">⚠️</span>
                                    <div>
                                        <p className="status-card-label">مخالفات الكلمات المحظورة</p>
                                        <p className="status-card-value">{user.bannedWords?.violations || 0} مخالفة</p>
                                        {user.bannedWords?.isBanned && (
                                            <p className="status-card-sub" style={{color: '#e74c3c'}}>محظور تلقائياً</p>
                                        )}
                                    </div>
                                </div>

                                <div className={`admin-status-card ${user.nameStatus?.status !== 'normal' && user.nameStatus?.status ? 'warning' : 'ok'}`}>
                                    <span className="status-card-icon">📛</span>
                                    <div>
                                        <p className="status-card-label">حالة الاسم</p>
                                        <p className="status-card-value">
                                            {(!user.nameStatus?.status || user.nameStatus.status === 'normal') && 'عادي'}
                                            {user.nameStatus?.status === 'suspended' && 'معلّق (يظهر ***)'}
                                            {user.nameStatus?.status === 'banned' && 'محظور (اسم محظور)'}
                                        </p>
                                        {user.nameStatus?.originalName && user.nameStatus.status !== 'normal' && (
                                            <p className="status-card-sub">الاسم الأصلي: {user.nameStatus.originalName}</p>
                                        )}
                                    </div>
                                </div>

                                <div className="admin-status-card ok">
                                    <span className="status-card-icon">🖼️</span>
                                    <div>
                                        <p className="status-card-label">الصور المحذوفة</p>
                                        <p className="status-card-value">{user.photoRemovals?.length || 0} صورة</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Suspension History */}
                        {user.suspension?.history && user.suspension.history.length > 0 && (
                            <div className="suspension-history-section">
                                <h4>📋 سجل التعليقات ({user.suspension.history.length})</h4>
                                <div className="suspension-history-list">
                                    {[...user.suspension.history].reverse().map((entry, idx) => (
                                        <div key={idx} className={`suspension-history-item ${entry.source === 'auto' ? 'auto' : 'admin'}`}>
                                            <div className="history-item-header">
                                                <span className={`history-source-badge ${entry.source}`}>
                                                    {entry.source === 'auto' ? '🤖 تلقائي' : '👤 أدمن'}
                                                </span>
                                                <span className="history-level-badge">المستوى {entry.level}</span>
                                                <span className="history-date">
                                                    {entry.suspendedAt ? new Date(entry.suspendedAt).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </span>
                                            </div>
                                            <p className="history-reason">{entry.reason || 'بدون سبب'}</p>
                                            <p className="history-duration">
                                                {entry.suspendedUntil
                                                    ? `حتى ${new Date(entry.suspendedUntil).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' })}`
                                                    : 'دائم'}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="admin-actions-grid">
                            {/* Suspend / Unsuspend */}
                            {user.suspension?.isSuspended ? (
                                <button className="admin-action-btn unsuspend" onClick={handleUnsuspendUser} disabled={actionLoading}>
                                    🔓 إلغاء التعليق
                                </button>
                            ) : (
                                <button className="admin-action-btn suspend" onClick={() => setShowSuspendModal(true)} disabled={actionLoading}>
                                    🔒 تعليق المستخدم
                                </button>
                            )}

                            {/* Set Violations */}
                            <button className="admin-action-btn violations" onClick={() => {
                                setViolationsCount(user.bannedWords?.violations || 0);
                                setShowViolationsModal(true);
                            }} disabled={actionLoading}>
                                ⚠️ تعديل المخالفات
                            </button>

                            {/* Name Action */}
                            <button className="admin-action-btn name-action" onClick={() => setShowNameModal(true)} disabled={actionLoading}>
                                📛 إجراء على الاسم
                            </button>

                            {/* Reset monthly change limits (grant exception) */}
                            <button
                                className="admin-action-btn"
                                style={{ background: '#10b981', color: 'var(--text-on-brand)', border: 'none' }}
                                onClick={handleResetChangeLimits}
                                disabled={actionLoading}
                                title="تصفير الحد الشهري لتغيير الاسم + قيد الصورة وإشعار المستخدم"
                            >
                                🔓 السماح بتغيير الاسم/الصورة
                                {(() => {
                                    const u = getNameChangeUsage();
                                    return (
                                        <span style={{ display: 'block', fontSize: 11, fontWeight: 400, opacity: 0.9, marginTop: 2 }}>
                                            تغييرات الاسم: {u.used}/{u.max}{u.reached ? ' — بلغ الحد ⚠️' : ''}
                                        </span>
                                    );
                                })()}
                            </button>

                            {/* Delete Photo */}
                            {user.profileImage && (
                                <button className="admin-action-btn delete-photo" onClick={() => setShowPhotoDeleteModal(true)} disabled={actionLoading}>
                                    🗑️ حذف الصورة
                                </button>
                            )}

                            {/* Restrict Photo/Name */}
                            <button className="admin-action-btn restrict" onClick={() => setShowRestrictModal(true)} disabled={actionLoading}>
                                ⛔ منع تغيير صورة/اسم
                            </button>

                            {/* ✅ تصعيد تلقائي */}
                            <button className="admin-action-btn" style={{background:"#2196F3",color:"#fff",border:"none"}} onClick={async () => {
                                try {
                                    const token = localStorage.getItem("token");
                                    const res = await fetch("/api/users/" + user._id + "/escalate", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ reason: "تصعيد من تفاصيل المستخدم" }) });
                                    const data = await res.json();
                                    if (data.success) { showToast(data.message, "success"); fetchUser(); }
                                    else showToast(data.message, "error");
                                } catch(e) { showToast("فشل التصعيد", "error"); }
                            }} disabled={actionLoading}>🔄 تصعيد تلقائي</button>

                            {/* ✅ تقييد جزائي — مودال موحّد */}
                            <button
                                className="admin-action-btn"
                                style={{background:"#FF9800",color:"#fff",border:"none"}}
                                onClick={() => setShowPartialModal(true)}
                                disabled={actionLoading}
                            >
                                🔒 تقييد جزائي
                            </button>

                            {/* ✅ شارة VIP (X) */}
                            <button
                                className="admin-action-btn"
                                style={{
                                    background: user.vipBadge?.grantedByAdmin ? "#8E8E93" : "linear-gradient(135deg,#1DA1F2,#0077D4)",
                                    color: "#fff",
                                    border: "none"
                                }}
                                onClick={async () => {
                                    const isGranted = user.vipBadge?.grantedByAdmin;
                                    const action = isGranted ? "سحب" : "منح";
                                    if (!window.confirm(`هل تريد ${action} شارة VIP لـ ${user.name}؟`)) return;
                                    const note = isGranted ? null : window.prompt("ملاحظة (اختياري)") || null;
                                    try {
                                        setActionLoading(true);
                                        const { setVipBadge } = await import("../services/api");
                                        const res = await setVipBadge(user._id, !isGranted, note);
                                        if (res.success) {
                                            showToast(res.message, "success");
                                            fetchUserActivity();
                                        }
                                    } catch(e) {
                                        showToast(e.response?.data?.message || `فشل ${action} VIP`, "error");
                                    } finally {
                                        setActionLoading(false);
                                    }
                                }}
                                disabled={actionLoading}
                            >
                                {user.vipBadge?.grantedByAdmin ? "⏸ سحب VIP" : "✕ منح VIP"}
                            </button>

                            {/* ✅ فك التقييد (سريع) — يظهر فقط لو المستخدم مقيّد فعلاً */}
                            {(user.restrictions?.messagingRestricted || user.suspension?.isSuspended) && (
                                <button
                                    className="admin-action-btn"
                                    style={{background:"#4CAF50",color:"#fff",border:"none"}}
                                    onClick={async () => {
                                        if (!window.confirm("فك جميع القيود عن " + user.name + " وإشعاره؟")) return;
                                        try {
                                            setActionLoading(true);
                                            const { suspendUser } = await import("../services/api");
                                            const res = await suspendUser(user._id, "unrestrict", "فك التقييد من الأدمن", true);
                                            if (res.success) {
                                                showToast(res.message || "تم فك التقييد", "success");
                                                fetchUserActivity();
                                            }
                                        } catch(e) {
                                            showToast(e.response?.data?.message || "فشل فك التقييد", "error");
                                        } finally {
                                            setActionLoading(false);
                                        }
                                    }}
                                    disabled={actionLoading}
                                >
                                    🔓 فك التقييد
                                </button>
                            )}

                            {/* ✅ حظر الجهاز */}
                            <button className="admin-action-btn" style={{background:"#9C27B0",color:"#fff",border:"none"}} onClick={async () => {
                                if (!window.confirm("هل أنت متأكد من حظر جهاز " + user.name + "؟ هذا إجراء نهائي!")) return;
                                try {
                                    const token = localStorage.getItem("token");
                                    const res = await fetch("/api/users/" + user._id + "/ban-device", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify({ reason: "admin", details: "حظر من تفاصيل المستخدم" }) });
                                    const data = await res.json();
                                    if (data.success) { showToast(data.message, "success"); fetchUser(); }
                                    else showToast(data.message, "error");
                                } catch(e) { showToast("فشل حظر الجهاز", "error"); }
                            }} disabled={actionLoading}>📵 حظر الجهاز</button>

                            {/* Send Notification */}
                            <button className="admin-action-btn notify" onClick={() => setShowNotifyModal(true)} disabled={actionLoading}>
                                📢 إرسال إشعار
                            </button>
                        </div>

                        {/* ✅ سجل المخالفات */}
                        {user.suspension?.history && user.suspension.history.length > 0 && (
                            <div style={{marginTop:"20px",background:"#fff",borderRadius:"12px",padding:"16px",boxShadow:"0 1px 4px rgba(0,0,0,0.08)"}}>
                                <h4 style={{margin:"0 0 12px",display:"flex",alignItems:"center",gap:"8px"}}>📋 سجل المخالفات والإجراءات ({user.suspension.history.length})</h4>
                                <div style={{maxHeight:"300px",overflowY:"auto"}}>
                                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
                                        <thead><tr style={{background:"#f5f5f5",textAlign:"right"}}>
                                            <th style={{padding:"8px"}}>المستوى</th>
                                            <th style={{padding:"8px"}}>السبب</th>
                                            <th style={{padding:"8px"}}>المصدر</th>
                                            <th style={{padding:"8px"}}>التاريخ</th>
                                        </tr></thead>
                                        <tbody>
                                            {user.suspension.history.slice().reverse().map((h, i) => (
                                                <tr key={i} style={{borderBottom:"1px solid #eee"}}>
                                                    <td style={{padding:"8px"}}><span style={{background: h.level >= 5 ? "#f44336" : h.level >= 3 ? "#FF9800" : "#FFC107", color:"#fff", padding:"2px 8px", borderRadius:"12px", fontSize:"11px"}}>{h.level}</span></td>
                                                    <td style={{padding:"8px"}}>{h.reason || "—"}</td>
                                                    <td style={{padding:"8px"}}>{h.source === "auto" ? "تلقائي" : h.source === "admin_escalate" ? "تصعيد أدمن" : "أدمن"}</td>
                                                    <td style={{padding:"8px",direction:"ltr"}}>{h.suspendedAt ? new Date(h.suspendedAt).toLocaleString("ar-SA") : "—"}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* ✅ سجل مخالفات الترويج الخارجي (Snap/Insta/زنجي/...) */}
                        {promoLogs && promoLogs.summary?.total > 0 && (
                            <div style={{marginTop:"20px",background:"#fff",borderRadius:"12px",padding:"16px",boxShadow:"0 1px 4px rgba(0,0,0,0.08)"}}>
                                <h4 style={{margin:"0 0 12px",display:"flex",alignItems:"center",gap:"8px"}}>
                                    🚫 محاولات الترويج الخارجي ({promoLogs.summary.total})
                                    {((promoLogs.user?.violations || 0) > 0 || (promoLogs.user?.lockCount || 0) > 0) && (
                                        <button
                                            style={{marginRight:"auto",background:"#4CAF50",color:"#fff",border:"none",borderRadius:"8px",padding:"6px 12px",fontSize:"12px",cursor:"pointer"}}
                                            disabled={actionLoading}
                                            onClick={async () => {
                                                if (!window.confirm("تصفير مخالفات الترويج الخارجي لـ " + user.name + "؟\n(العداد + درجة التصعيد + فك أقفال النبذة/المراسلة المرتبطة بها)")) return;
                                                try {
                                                    setActionLoading(true);
                                                    const { resetPromoViolations } = await import("../services/api");
                                                    const res = await resetPromoViolations(user._id, { resetCounter: true, resetLockCount: true, notify: true });
                                                    if (res.success) {
                                                        showToast("تم تصفير مخالفات الترويج الخارجي", "success");
                                                        fetchPromoLogs();
                                                        fetchUserActivity();
                                                    }
                                                } catch (e) {
                                                    showToast(e.response?.data?.message || "فشل التصفير", "error");
                                                } finally {
                                                    setActionLoading(false);
                                                }
                                            }}
                                        >
                                            ♻️ تصفير المخالفات
                                        </button>
                                    )}
                                </h4>

                                {/* Summary chips */}
                                <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginBottom:"12px",fontSize:"12px"}}>
                                    <span style={{background:"#fef3c7",padding:"4px 10px",borderRadius:"12px"}}>
                                        العداد الحالي: <b>{promoLogs.user?.violations || 0}</b> / 10
                                    </span>
                                    {(promoLogs.user?.lockCount || 0) > 0 && (
                                        <span style={{background:"#fde68a",padding:"4px 10px",borderRadius:"12px"}}>
                                            درجة التصعيد: <b>{promoLogs.user.lockCount}</b>
                                        </span>
                                    )}
                                    {promoLogs.user?.bioLockedUntil && new Date(promoLogs.user.bioLockedUntil) > new Date() && (
                                        <span style={{background:"#fee2e2",padding:"4px 10px",borderRadius:"12px",color:"#b91c1c"}}>
                                            🔒 النبذة مقفولة حتى {new Date(promoLogs.user.bioLockedUntil).toLocaleString("ar-SA")}
                                        </span>
                                    )}
                                    {Object.entries(promoLogs.summary.byCategory || {}).slice(0, 5).map(([cat, n]) => (
                                        <span key={cat} style={{background:"#dbeafe",padding:"4px 10px",borderRadius:"12px"}}>
                                            {cat}: {n}
                                        </span>
                                    ))}
                                    {Object.entries(promoLogs.summary.bySource || {}).map(([src, n]) => (
                                        <span key={src} style={{background:"#e0e7ff",padding:"4px 10px",borderRadius:"12px"}}>
                                            {src === 'bio' ? '📝 نبذة' : src === 'message' ? '💬 رسالة' : '👤 اسم'}: {n}
                                        </span>
                                    ))}
                                </div>

                                {/* Logs table */}
                                <div style={{maxHeight:"260px",overflowY:"auto"}}>
                                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
                                        <thead><tr style={{background:"#f5f5f5",textAlign:"right"}}>
                                            <th style={{padding:"6px"}}>المنصات</th>
                                            <th style={{padding:"6px"}}>المصدر</th>
                                            <th style={{padding:"6px"}}>النصوص المطابقة</th>
                                            <th style={{padding:"6px"}}>التاريخ</th>
                                        </tr></thead>
                                        <tbody>
                                            {promoLogs.logs.map((log, i) => (
                                                <tr key={log._id || i} style={{borderBottom:"1px solid #eee"}}>
                                                    <td style={{padding:"6px"}}>{(log.categories || []).join(', ')}</td>
                                                    <td style={{padding:"6px"}}>{log.source === 'bio' ? '📝' : log.source === 'message' ? '💬' : '👤'} {log.source}</td>
                                                    <td style={{padding:"6px",fontFamily:"monospace",fontSize:"11px",color:"#6b7280"}}>
                                                        {(log.matchedPatterns || []).slice(0, 3).join(' · ').slice(0, 80)}
                                                    </td>
                                                    <td style={{padding:"6px",direction:"ltr"}}>{new Date(log.createdAt).toLocaleString("ar-SA")}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Active Restrictions */}
                        {(user.restrictions?.photoBlocked || user.restrictions?.nameBlocked) && (
                            <div className="active-restrictions">
                                <h4>⛔ القيود النشطة</h4>
                                {user.restrictions.photoBlocked && (
                                    <div className="restriction-item photo">
                                        <span>📷 منع تغيير الصورة</span>
                                        <span>{user.restrictions.photoBlockedUntil ? `حتى ${formatDate(user.restrictions.photoBlockedUntil)}` : 'دائم'}</span>
                                        <span className="restriction-reason">{user.restrictions.photoBlockedReason}</span>
                                    </div>
                                )}
                                {user.restrictions.nameBlocked && (
                                    <div className="restriction-item name">
                                        <span>📛 منع تغيير الاسم</span>
                                        <span>{user.restrictions.nameBlockedUntil ? `حتى ${formatDate(user.restrictions.nameBlockedUntil)}` : 'دائم'}</span>
                                        <span className="restriction-reason">{user.restrictions.nameBlockedReason}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* User Interests */}
                        {user.interests && user.interests.length > 0 && (
                            <div className="user-interests-section">
                                <h4>✨ الاهتمامات</h4>
                                <div className="interests-chips">
                                    {user.interests.map((interest, idx) => (
                                        <span key={idx} className="interest-chip">{interest}</span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Photo Removals History */}
                        {user.photoRemovals && user.photoRemovals.length > 0 && (
                            <div className="photo-removals-history">
                                <h4>📋 سجل حذف الصور</h4>
                                <div className="removals-list">
                                    {user.photoRemovals.map((removal, idx) => (
                                        <div key={idx} className="removal-item">
                                            <span>🗑️ {removal.reason || 'بدون سبب'}</span>
                                            <span className="removal-date">{formatDate(removal.removedAt)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ========== Admin Modals ========== */}

            {/* Suspend Modal */}
            {showSuspendModal && (
                <div className="modal-overlay" onClick={() => setShowSuspendModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🔒 تعليق المستخدم</h3>
                            <button className="close-modal-btn" onClick={() => setShowSuspendModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* Next Level Suggestion */}
                            {(() => {
                                const currentLevel = user.suspension?.level || 0;
                                const nextLevel = Math.min(currentLevel + 1, 5);
                                const levelNames = { 1: '24 ساعة', 2: '48 ساعة', 3: '3 أيام', 4: '7 أيام', 5: 'دائم' };
                                const levelCodes = { 1: '24h', 2: '48h', 3: '3d', 4: '7d', 5: 'permanent' };
                                return (
                                    <div className={`next-level-suggestion ${nextLevel === 5 ? 'danger' : 'info'}`}>
                                        <p>المستوى الحالي: <strong>{currentLevel}</strong> — المستوى التالي المقترح: <strong>{nextLevel} ({levelNames[nextLevel]})</strong></p>
                                        {nextLevel === 5 && <p style={{color: '#e74c3c', fontWeight: 'bold'}}>تحذير: المستوى التالي هو تعليق دائم!</p>}
                                        <button
                                            className="auto-level-btn"
                                            onClick={() => setSuspendForm({...suspendForm, duration: 'auto'})}
                                        >
                                            استخدام المستوى التالي تلقائياً ({levelNames[nextLevel]})
                                        </button>
                                    </div>
                                );
                            })()}

                            <div className="form-group">
                                <label>مدة التعليق</label>
                                <select value={suspendForm.duration} onChange={(e) => setSuspendForm({...suspendForm, duration: e.target.value})}>
                                    <option value="auto">تلقائي (المستوى التالي)</option>
                                    <option value="24h">24 ساعة (مستوى 1)</option>
                                    <option value="48h">48 ساعة (مستوى 2)</option>
                                    <option value="3d">3 أيام (مستوى 3)</option>
                                    <option value="7d">أسبوع (مستوى 4)</option>
                                    <option value="permanent">دائم (مستوى 5)</option>
                                    <option value="custom">مدة مخصصة</option>
                                </select>
                            </div>
                            {suspendForm.duration === 'custom' && (
                                <div className="form-group">
                                    <label>عدد الأيام</label>
                                    <input
                                        type="number"
                                        min="1"
                                        max="365"
                                        value={suspendForm.customDays}
                                        onChange={(e) => setSuspendForm({...suspendForm, customDays: parseInt(e.target.value) || 1})}
                                    />
                                </div>
                            )}
                            <div className="form-group">
                                <label>سبب التعليق</label>
                                <textarea
                                    value={suspendForm.reason}
                                    onChange={(e) => setSuspendForm({...suspendForm, reason: e.target.value})}
                                    placeholder="أدخل سبب التعليق..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowSuspendModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleSuspendUser} disabled={actionLoading}>
                                {actionLoading ? 'جاري التعليق...' : 'تعليق المستخدم'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ Hide Account Modal */}
            {showHideModal && (
                <div className="modal-overlay" onClick={() => setShowHideModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🙈 إخفاء الحساب</h3>
                            <button className="close-modal-btn" onClick={() => setShowHideModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div style={{
                                padding: 12,
                                background: 'var(--tint-warning)',
                                border: '1px solid #f59e0b',
                                borderRadius: 8,
                                marginBottom: 14,
                                fontSize: 13,
                                color: 'var(--text-warning)'
                            }}>
                                ℹ️ <strong>عقوبة أخف من التعليق:</strong> المستخدم يستطيع تسجيل الدخول والمحادثة،
                                لكن حسابه لن يظهر في الاكتشاف والبحث، وستظهر صورته مبهمة واسمه مخفي لمن يراه.
                                يستطيع الاستئناف من تطبيقه.
                            </div>
                            <div className="form-group">
                                <label>مدة الإخفاء</label>
                                <select value={hideDuration} onChange={(e) => setHideDuration(e.target.value)}>
                                    <option value="24h">24 ساعة (موصى)</option>
                                    <option value="3d">3 أيام</option>
                                    <option value="7d">أسبوع</option>
                                    <option value="30d">30 يوم</option>
                                    <option value="permanent">دائم</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>أسباب سريعة</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {HIDE_QUICK_REASONS.map(r => (
                                        <button
                                            key={r}
                                            type="button"
                                            onClick={() => {
                                                setHideReason(prev => {
                                                    if (!prev) return r;
                                                    if (prev.includes(r)) return prev;
                                                    return prev.trim().endsWith('+') ? `${prev} ${r}` : `${prev} + ${r}`;
                                                });
                                            }}
                                            style={{
                                                padding: '6px 10px',
                                                fontSize: 12,
                                                border: '1px solid var(--border-color)',
                                                background: hideReason.includes(r) ? '#fef3c7' : '#f9fafb',
                                                borderRadius: 999,
                                                cursor: 'pointer',
                                                color: 'var(--text-primary)',
                                                fontWeight: hideReason.includes(r) ? 600 : 400
                                            }}
                                        >
                                            {r}
                                        </button>
                                    ))}
                                    {hideReason && (
                                        <button
                                            type="button"
                                            onClick={() => setHideReason('')}
                                            style={{
                                                padding: '6px 10px',
                                                fontSize: 12,
                                                border: '1px dashed #ef4444',
                                                background: 'var(--tint-danger)',
                                                borderRadius: 999,
                                                cursor: 'pointer',
                                                color: 'var(--text-danger)'
                                            }}
                                        >
                                            ✕ مسح
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="form-group">
                                <label>السبب (يظهر للمستخدم)</label>
                                <textarea
                                    value={hideReason}
                                    onChange={(e) => setHideReason(e.target.value)}
                                    placeholder="اختر من الأسباب السريعة أعلاه أو اكتب سبباً مخصصاً..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowHideModal(false)} disabled={hideLoading}>إلغاء</button>
                            <button
                                className="submit-btn"
                                onClick={handleHideUser}
                                disabled={hideLoading}
                                style={{ background: '#f59e0b' }}
                            >
                                {hideLoading ? 'جاري الإخفاء...' : '🙈 إخفاء الحساب'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Violations Modal */}
            {showViolationsModal && (
                <div className="modal-overlay" onClick={() => setShowViolationsModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>⚠️ تعديل عدد المخالفات</h3>
                            <button className="close-modal-btn" onClick={() => setShowViolationsModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{marginBottom: '12px', color: 'var(--text-secondary)'}}>
                                المخالفات الحالية: <strong>{user.bannedWords?.violations || 0}</strong>
                            </p>
                            <div className="form-group">
                                <label>عدد المخالفات الجديد</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={violationsCount}
                                    onChange={(e) => setViolationsCount(parseInt(e.target.value) || 0)}
                                />
                            </div>
                            <p style={{fontSize: '13px', color: '#e67e22', marginTop: '8px'}}>
                                تنبيه: إذا تجاوز العدد حد المخالفات سيتم حظر المستخدم تلقائياً
                            </p>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowViolationsModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn" onClick={handleSetViolations} disabled={actionLoading}>
                                {actionLoading ? 'جاري التحديث...' : 'تحديث المخالفات'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Name Action Modal */}
            {showNameModal && (
                <div className="modal-overlay" onClick={() => setShowNameModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📛 إجراء على الاسم</h3>
                            <button className="close-modal-btn" onClick={() => setShowNameModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <p style={{marginBottom: '12px'}}>
                                الاسم الحالي: <strong>{user.name}</strong>
                                {user.nameStatus?.status && user.nameStatus.status !== 'normal' && (
                                    <span style={{color: '#e74c3c', marginRight: '8px'}}>
                                        ({user.nameStatus.status === 'suspended' ? 'معلّق' : 'محظور'})
                                    </span>
                                )}
                            </p>
                            <div className="form-group">
                                <label>نوع الإجراء</label>
                                <select value={nameForm.action} onChange={(e) => setNameForm({...nameForm, action: e.target.value})}>
                                    <option value="suspend">تعليق الاسم (يظهر ***)</option>
                                    <option value="ban">حظر الاسم (يظهر "اسم محظور")</option>
                                    <option value="restore">استعادة الاسم الأصلي</option>
                                    <option value="change">تغيير الاسم</option>
                                </select>
                            </div>
                            {nameForm.action === 'change' && (
                                <div className="form-group">
                                    <label>الاسم الجديد</label>
                                    <input
                                        type="text"
                                        value={nameForm.newName}
                                        onChange={(e) => setNameForm({...nameForm, newName: e.target.value})}
                                        placeholder="أدخل الاسم الجديد..."
                                    />
                                </div>
                            )}
                            <div className="form-group">
                                <label>السبب</label>
                                <textarea
                                    value={nameForm.reason}
                                    onChange={(e) => setNameForm({...nameForm, reason: e.target.value})}
                                    placeholder="أدخل سبب الإجراء..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button
                                className="cancel-btn"
                                onClick={handleViewNameHistory}
                                disabled={actionLoading}
                                style={{background:'#eef2ff',color:'#4338ca',border:'1px solid #c7d2fe',marginLeft:'auto'}}
                            >
                                📜 عرض سجل التغييرات
                            </button>
                            <button className="cancel-btn" onClick={() => setShowNameModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleNameAction} disabled={actionLoading}>
                                {actionLoading ? 'جاري التنفيذ...' : 'تنفيذ الإجراء'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Name History Modal */}
            {showNameHistoryModal && (
                <div className="modal-overlay" onClick={() => setShowNameHistoryModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()} style={{maxWidth:'720px',maxHeight:'85vh'}}>
                        <div className="modal-header">
                            <h3>📜 سجل تغييرات الاسم</h3>
                            <button className="close-modal-btn" onClick={() => setShowNameHistoryModal(false)}>✕</button>
                        </div>
                        <div className="modal-body" style={{overflowY:'auto',maxHeight:'70vh'}}>
                            {loadingNameHistory ? (
                                <div style={{textAlign:'center',padding:'40px'}}>⏳ جاري التحميل...</div>
                            ) : !nameHistoryData ? (
                                <div style={{textAlign:'center',padding:'40px',color: 'var(--text-secondary)'}}>لا توجد بيانات</div>
                            ) : (
                                <div>
                                    {/* الإحصائيات */}
                                    <div style={{display:'grid',gridTemplateColumns:'repeat(4, 1fr)',gap:'10px',marginBottom:'18px'}}>
                                        <div style={{padding:'10px',background: 'var(--bg-subtle)',borderRadius:'8px',textAlign:'center'}}>
                                            <div style={{fontSize:'20px',fontWeight:'bold',color: 'var(--text-primary)'}}>{nameHistoryData.totalChanges}</div>
                                            <div style={{fontSize:'11px',color: 'var(--text-secondary)'}}>إجمالي التغييرات</div>
                                        </div>
                                        <div style={{padding:'10px',background:'#dbeafe',borderRadius:'8px',textAlign:'center'}}>
                                            <div style={{fontSize:'20px',fontWeight:'bold',color:'#1e40af'}}>{nameHistoryData.stats.userInitiated}</div>
                                            <div style={{fontSize:'11px',color:'#1e40af'}}>من المستخدم</div>
                                        </div>
                                        <div style={{padding:'10px',background:'#fef3c7',borderRadius:'8px',textAlign:'center'}}>
                                            <div style={{fontSize:'20px',fontWeight:'bold',color:'#92400e'}}>{nameHistoryData.stats.adminInitiated}</div>
                                            <div style={{fontSize:'11px',color:'#92400e'}}>من الأدمن</div>
                                        </div>
                                        <div style={{padding:'10px',background:'#fce7f3',borderRadius:'8px',textAlign:'center'}}>
                                            <div style={{fontSize:'20px',fontWeight:'bold',color:'#9d174d'}}>{nameHistoryData.stats.last30Days}</div>
                                            <div style={{fontSize:'11px',color:'#9d174d'}}>آخر 30 يوم</div>
                                        </div>
                                    </div>

                                    {/* الاسم الحالي */}
                                    <div style={{padding:'12px',background:'#ecfdf5',borderRadius:'8px',marginBottom:'14px',border:'1px solid #6ee7b7'}}>
                                        <span style={{fontSize:'12px',color:'#047857'}}>الاسم الحالي:</span>{' '}
                                        <strong style={{fontSize:'15px',color:'#064e3b'}}>{nameHistoryData.currentName}</strong>
                                    </div>

                                    {/* السجل */}
                                    {nameHistoryData.history.length === 0 ? (
                                        <div style={{textAlign:'center',padding:'24px',color: 'var(--text-secondary)',background: 'var(--bg-subtle)',borderRadius:'8px'}}>
                                            لم يتم تسجيل أي تغييرات لهذا المستخدم
                                            <div style={{fontSize:'11px',marginTop:'6px'}}>
                                                (السجل التفصيلي يبدأ من تاريخ تفعيل الميزة)
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                                            {nameHistoryData.history.map((entry, idx) => {
                                                const isAdmin = entry.source === 'admin';
                                                const date = new Date(entry.changedAt);
                                                const dateStr = date.toLocaleString('ar-SA', {
                                                    year: 'numeric', month: 'short', day: 'numeric',
                                                    hour: '2-digit', minute: '2-digit'
                                                });
                                                return (
                                                    <div key={idx} style={{
                                                        padding:'12px',
                                                        background: isAdmin ? '#fffbeb' : '#f8fafc',
                                                        borderLeft: `3px solid ${isAdmin ? '#f59e0b' : '#3b82f6'}`,
                                                        borderRadius:'6px'
                                                    }}>
                                                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                                                            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                                                                <span style={{
                                                                    padding:'2px 8px',
                                                                    borderRadius:'4px',
                                                                    fontSize:'10px',
                                                                    fontWeight:'bold',
                                                                    background: isAdmin ? '#f59e0b' : '#3b82f6',
                                                                    color: 'var(--text-on-brand)'
                                                                }}>
                                                                    {isAdmin ? '🛡️ أدمن' : '👤 المستخدم'}
                                                                </span>
                                                                {isAdmin && entry.changedBy && (
                                                                    <span style={{fontSize:'12px',color:'#92400e'}}>
                                                                        بواسطة: <strong>{entry.changedBy.name || entry.changedBy.email || '?'}</strong>
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span style={{fontSize:'11px',color: 'var(--text-secondary)'}}>{dateStr}</span>
                                                        </div>
                                                        <div style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'14px'}}>
                                                            <span style={{color:'#dc2626',textDecoration:'line-through'}}>
                                                                {entry.from || '(فارغ)'}
                                                            </span>
                                                            <span style={{color: 'var(--text-secondary)'}}>←</span>
                                                            <strong style={{color:'#16a34a'}}>{entry.to}</strong>
                                                        </div>
                                                        {entry.reason && (
                                                            <div style={{marginTop:'6px',fontSize:'12px',color: 'var(--text-secondary)',fontStyle:'italic'}}>
                                                                السبب: {entry.reason}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowNameHistoryModal(false)}>إغلاق</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Photo Delete Modal */}
            {showPhotoDeleteModal && (
                <div className="modal-overlay" onClick={() => setShowPhotoDeleteModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🗑️ حذف صورة المستخدم</h3>
                            <button className="close-modal-btn" onClick={() => setShowPhotoDeleteModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            {/* اختيار الصورة المراد حذفها */}
                            <div className="form-group">
                                <label>اختر الصورة المراد حذفها</label>
                                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px'}}>
                                    {/* الصورة الرئيسية */}
                                    {user.profileImage && (
                                        <div
                                            onClick={() => setPhotoDeleteForm({...photoDeleteForm, photoIndex: 'profile'})}
                                            style={{
                                                cursor: 'pointer',
                                                border: photoDeleteForm.photoIndex === 'profile' ? '3px solid #e74c3c' : '3px solid transparent',
                                                borderRadius: '12px', padding: '4px', textAlign: 'center'
                                            }}
                                        >
                                            <img
                                                src={getImageUrl(user.profileImage)}
                                                alt="الرئيسية"
                                                style={{width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover'}}
                                                onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                            <div style={{fontSize: '11px', marginTop: '4px', color: photoDeleteForm.photoIndex === 'profile' ? '#e74c3c' : '#666'}}>
                                                الرئيسية
                                            </div>
                                        </div>
                                    )}
                                    {/* الصور الإضافية */}
                                    {(user.photos || []).map((photo, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => setPhotoDeleteForm({...photoDeleteForm, photoIndex: idx})}
                                            style={{
                                                cursor: 'pointer',
                                                border: photoDeleteForm.photoIndex === idx ? '3px solid #e74c3c' : '3px solid transparent',
                                                borderRadius: '12px', padding: '4px', textAlign: 'center'
                                            }}
                                        >
                                            <img
                                                src={getImageUrl(photo.thumbnail || photo.medium || photo.original)}
                                                alt={`صورة ${idx + 1}`}
                                                style={{width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover'}}
                                                onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                            <div style={{fontSize: '11px', marginTop: '4px', color: photoDeleteForm.photoIndex === idx ? '#e74c3c' : '#666'}}>
                                                صورة {idx + 1}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="form-group">
                                <label>سبب الحذف (سيتم إشعار المستخدم داخل التطبيق)</label>
                                <textarea
                                    value={photoDeleteForm.reason}
                                    onChange={(e) => setPhotoDeleteForm({...photoDeleteForm, reason: e.target.value})}
                                    placeholder="صورة غير لائقة / تنتهك شروط الاستخدام..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowPhotoDeleteModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleDeletePhoto} disabled={actionLoading}>
                                {actionLoading ? 'جاري الحذف...' : '🗑️ حذف الصورة + إشعار المستخدم'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ Upload / Replace Profile Image Modal */}
            {showPhotoUploadModal && (
                <div className="modal-overlay" onClick={() => setShowPhotoUploadModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🖼️ {user.profileImage ? 'استبدال' : 'رفع'} الصورة الشخصية لـ {user.name}</h3>
                            <button className="close-modal-btn" onClick={() => setShowPhotoUploadModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>الصورة الجديدة (حد أقصى 2 ميجابايت)</label>
                                <input type="file" accept="image/*" onChange={handlePhotoFileSelect} />
                            </div>
                            {photoUploadForm.preview && (
                                <div style={{ textAlign: 'center', margin: '12px 0' }}>
                                    <img
                                        src={photoUploadForm.preview}
                                        alt="معاينة"
                                        style={{ width: 140, height: 140, objectFit: 'cover', borderRadius: 12, border: '2px solid #6366f1' }}
                                    />
                                </div>
                            )}
                            <div className="form-group">
                                <label>سبب/ملاحظة للمستخدم (اختياري)</label>
                                <textarea
                                    value={photoUploadForm.reason}
                                    onChange={(e) => setPhotoUploadForm({ ...photoUploadForm, reason: e.target.value })}
                                    placeholder="مثال: تم استبدال الصورة المخالفة بصورة مناسبة"
                                    rows={2}
                                />
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                                <input
                                    type="checkbox"
                                    checked={photoUploadForm.notify}
                                    onChange={(e) => setPhotoUploadForm({ ...photoUploadForm, notify: e.target.checked })}
                                />
                                إشعار المستخدم بالتغيير (push + داخل التطبيق)
                            </label>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowPhotoUploadModal(false)} disabled={photoUploadLoading}>إلغاء</button>
                            <button className="submit-btn" onClick={handleUploadPhoto} disabled={photoUploadLoading || !photoUploadForm.file}>
                                {photoUploadLoading ? 'جاري الرفع...' : '⬆️ حفظ الصورة' + (photoUploadForm.notify ? ' + إشعار' : '')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Send Notification Modal */}
            {showNotifyModal && (
                <div className="modal-overlay" onClick={() => setShowNotifyModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📢 إرسال إشعار لـ {user.name}</h3>
                            <button className="close-modal-btn" onClick={() => setShowNotifyModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>عنوان الإشعار *</label>
                                <input
                                    type="text"
                                    value={notifyForm.title}
                                    onChange={(e) => setNotifyForm({...notifyForm, title: e.target.value})}
                                    placeholder="عنوان الإشعار"
                                    maxLength={100}
                                />
                            </div>
                            <div className="form-group">
                                <label>محتوى الإشعار *</label>
                                <textarea
                                    value={notifyForm.body}
                                    onChange={(e) => setNotifyForm({...notifyForm, body: e.target.value})}
                                    placeholder="محتوى الإشعار..."
                                    rows={4}
                                    maxLength={500}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowNotifyModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn" onClick={handleSendNotification} disabled={actionLoading}>
                                {actionLoading ? 'جاري الإرسال...' : 'إرسال الإشعار'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Restrict Photo/Name Modal */}
            {showRestrictModal && (
                <div className="modal-overlay" onClick={() => setShowRestrictModal(false)}>
                    <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>⛔ منع تغيير صورة/اسم/نبذة</h3>
                            <button className="close-modal-btn" onClick={() => setShowRestrictModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>نوع المنع</label>
                                <select value={restrictForm.type} onChange={(e) => setRestrictForm({...restrictForm, type: e.target.value})}>
                                    <option value="photo">📷 منع تغيير الصورة</option>
                                    <option value="name">📛 منع تغيير الاسم</option>
                                    <option value="bio">📝 منع تعديل النبذة</option>
                                    <option value="messaging_new">💬 منع بدء محادثات جديدة (يمكنه الرد)</option>
                                    <option value="messaging_all">🚫 منع جميع المراسلة (لا بدء ولا رد)</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>المدة</label>
                                <select value={restrictForm.duration} onChange={(e) => setRestrictForm({...restrictForm, duration: e.target.value})}>
                                    <option value="24h">24 ساعة</option>
                                    <option value="48h">48 ساعة</option>
                                    <option value="7d">7 أيام</option>
                                    <option value="30d">30 يوم</option>
                                    <option value="90d">90 يوم</option>
                                    <option value="permanent">دائم</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>السبب (سيتم إشعار المستخدم)</label>
                                <textarea
                                    value={restrictForm.reason}
                                    onChange={(e) => setRestrictForm({...restrictForm, reason: e.target.value})}
                                    placeholder="صورة/اسم/نبذة مخالفة لسياسة الاستخدام..."
                                    rows={3}
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowRestrictModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn danger" onClick={handleRestrict} disabled={actionLoading}>
                                {actionLoading ? 'جاري التطبيق...' : '⛔ تطبيق المنع + إشعار المستخدم'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ Partial Restriction Modal (تقييد جزائي موحّد) */}
            {showPartialModal && (
                <div className="modal-overlay" onClick={() => setShowPartialModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🔒 تقييد جزائي</h3>
                            <button className="close-modal-btn" onClick={() => setShowPartialModal(false)}>✕</button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>الإجراء</label>
                                <select
                                    value={partialForm.action}
                                    onChange={(e) => setPartialForm({ ...partialForm, action: e.target.value })}
                                >
                                    <option value="messaging_new">💬 منع بدء محادثات جديدة (يمكنه الرد)</option>
                                    <option value="messaging_all">🚫 منع جميع المراسلة (لا بدء ولا رد)</option>
                                    <option value="unrestrict">🔓 إلغاء التقييد الجزائي</option>
                                </select>
                            </div>

                            {partialForm.action !== 'unrestrict' && (
                                <div className="form-group">
                                    <label>المدة</label>
                                    <select
                                        value={partialForm.duration}
                                        onChange={(e) => setPartialForm({ ...partialForm, duration: e.target.value })}
                                    >
                                        <option value="24h">24 ساعة</option>
                                        <option value="48h">48 ساعة</option>
                                        <option value="7d">7 أيام</option>
                                        <option value="30d">30 يوم</option>
                                        <option value="90d">90 يوم</option>
                                        <option value="permanent">دائم</option>
                                    </select>
                                </div>
                            )}

                            <div className="form-group">
                                <label>
                                    {partialForm.action === 'unrestrict' ? 'ملاحظة (اختياري)' : 'السبب (سيُرسل للمستخدم)'}
                                </label>
                                <textarea
                                    value={partialForm.reason}
                                    onChange={(e) => setPartialForm({ ...partialForm, reason: e.target.value })}
                                    placeholder={partialForm.action === 'unrestrict'
                                        ? 'سيُرسل إشعار للمستخدم بفك القيود...'
                                        : 'مخالفة سياسة المراسلة...'}
                                    rows={3}
                                />
                            </div>

                            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input
                                    type="checkbox"
                                    id="partialNotify"
                                    checked={partialForm.notify}
                                    onChange={(e) => setPartialForm({ ...partialForm, notify: e.target.checked })}
                                />
                                <label htmlFor="partialNotify" style={{ margin: 0 }}>
                                    {partialForm.action === 'unrestrict'
                                        ? '🔔 إشعار المستخدم بفك التقييد'
                                        : '🔔 إشعار المستخدم بالتقييد'}
                                </label>
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowPartialModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button
                                className="submit-btn"
                                style={{ background: partialForm.action === 'unrestrict' ? '#4CAF50' : '#FF9800' }}
                                onClick={handlePartialAction}
                                disabled={actionLoading}
                            >
                                {actionLoading
                                    ? 'جاري التنفيذ...'
                                    : partialForm.action === 'unrestrict' ? '🔓 فك التقييد' : '🔒 تطبيق التقييد'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Photo Lightbox */}
            {lightboxImage && (
                <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
                    <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
                        <button className="lightbox-close" onClick={() => setLightboxImage(null)}>✕</button>
                        <img src={lightboxImage} alt="صورة كاملة" className="lightbox-image" />
                    </div>
                </div>
            )}

            {/* 🛡️ Official Warning Modal */}
            {showWarningModal && selectedTemplate && (
                <div className="modal-overlay" onClick={() => !actionLoading && setShowWarningModal(false)}>
                    <div className="modal-content" style={{maxWidth:540}} onClick={(e)=>e.stopPropagation()}>
                        <div className="modal-header" style={{borderBottom: '1px solid var(--border-color)',paddingBottom:12}}>
                            <h3 style={{margin:0}}>{selectedTemplate.icon} {selectedTemplate.label}</h3>
                            <button className="close-btn" onClick={() => !actionLoading && setShowWarningModal(false)}>✕</button>
                        </div>
                        <div className="modal-body" style={{padding:'16px 0'}}>
                            <div style={{padding:12,background:'var(--tint-info)',borderRadius:10,marginBottom:16,fontSize:13,color: 'var(--text-info)'}}>
                                💡 سيظهر التنبيه للمستخدم كـ <strong>Modal إجباري</strong> داخل التطبيق + Push notification + إشعار داخلي
                            </div>

                            <div className="form-group">
                                <label>العنوان</label>
                                <input
                                    type="text"
                                    value={warningForm.customTitle}
                                    onChange={(e) => setWarningForm({...warningForm, customTitle: e.target.value})}
                                    disabled={selectedTemplate.key !== 'custom'}
                                    placeholder={selectedTemplate.key === 'custom' ? 'عنوان التنبيه' : ''}
                                />
                            </div>

                            <div className="form-group">
                                <label>نص الرسالة</label>
                                <textarea
                                    value={warningForm.customBody}
                                    onChange={(e) => setWarningForm({...warningForm, customBody: e.target.value})}
                                    rows={5}
                                    placeholder={selectedTemplate.key === 'custom' ? 'اكتب نص التنبيه...' : ''}
                                    style={{width:'100%',direction:'rtl'}}
                                />
                                <div style={{fontSize:11,color: 'var(--text-secondary)',marginTop:4}}>
                                    {selectedTemplate.key !== 'custom' ? 'يمكنك تعديل النص أو تركه كما هو' : 'مطلوب'}
                                </div>
                            </div>

                            <div style={{display:'flex',gap:12,marginTop:12,flexWrap:'wrap'}}>
                                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                                    <input
                                        type="checkbox"
                                        checked={warningForm.isBlocking}
                                        onChange={(e) => setWarningForm({...warningForm, isBlocking: e.target.checked})}
                                    />
                                    <span>🔒 إجباري (Modal لا يُغلق حتى الضغط على "فهمت")</span>
                                </label>
                            </div>
                            <div style={{display:'flex',gap:12,marginTop:6,flexWrap:'wrap'}}>
                                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
                                    <input
                                        type="checkbox"
                                        checked={warningForm.recordViolation}
                                        onChange={(e) => setWarningForm({...warningForm, recordViolation: e.target.checked})}
                                        disabled={selectedTemplate.key === 'custom'}
                                    />
                                    <span>📋 تسجيل في سجل المخالفات</span>
                                </label>
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button className="cancel-btn" onClick={() => setShowWarningModal(false)} disabled={actionLoading}>إلغاء</button>
                            <button className="submit-btn" onClick={handleSendWarning} disabled={actionLoading} style={{background:'#dc2626'}}>
                                {actionLoading ? 'جاري الإرسال...' : `📤 إرسال التنبيه`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default UserDetail;

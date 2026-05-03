import React, { useState, useEffect, useCallback } from 'react';
import config from '../config';
import LoadingSpinner from '../components/LoadingSpinner';
import Pagination from '../components/Pagination';
import ConfirmModal from '../components/ConfirmModal';
import './BannedWords.css';

const API_URL = config.API_URL;

const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
};

// --- مساعد: حساب الوقت المنقضي بالعربي ---
const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'الآن';
    if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
    if (diffHour < 24) return `منذ ${diffHour} ساعة`;
    if (diffDay < 7) return `منذ ${diffDay} يوم`;
    return new Date(dateStr).toLocaleDateString('ar-SA');
};

// --- خيارات الإجراءات المتاحة في المراجعة ---
const REVIEW_ACTIONS = [
    { value: 'dismiss', label: 'رفض البلاغ (لا شيء)', icon: '✅' },
    { value: 'warning', label: 'إرسال تحذير', icon: '⚠️' },
    { value: 'message_deleted', label: 'حذف الرسالة', icon: '🗑️' },
    { value: 'user_suspended_1h', label: 'تعليق ساعة', icon: '⏸️' },
    { value: 'user_suspended_24h', label: 'تعليق 24 ساعة', icon: '⏸️' },
    { value: 'user_suspended_3d', label: 'تعليق 3 أيام', icon: '⏸️' },
    { value: 'user_suspended_7d', label: 'تعليق 7 أيام', icon: '⏸️' },
    { value: 'user_banned', label: 'حظر نهائي', icon: '🚫' },
    { value: 'delete_account', label: 'حذف الحساب', icon: '💀' },
];

// --- خريطة مدة التعليق حسب الإجراء ---
const SUSPEND_DURATION_MAP = {
    'user_suspended_1h': '1h',
    'user_suspended_24h': '24h',
    'user_suspended_3d': '3d',
    'user_suspended_7d': '7d',
};

function BannedWords({ onViewUserDetail, onViewConversation }) {
    const [activeTab, setActiveTab] = useState('words');
    const [loading, setLoading] = useState(true);

    // === حالة تبويب الكلمات المحظورة ===
    const [words, setWords] = useState([]);
    const [wordsTotal, setWordsTotal] = useState(0);
    const [wordsPage, setWordsPage] = useState(1);
    const [wordsSearch, setWordsSearch] = useState('');
    const [wordsCategoryFilter, setWordsCategoryFilter] = useState('');
    const [wordsLanguageFilter, setWordsLanguageFilter] = useState('');

    // === حالة تبويب الرسائل المحظورة ===
    const [flagged, setFlagged] = useState([]);
    const [flaggedTotal, setFlaggedTotal] = useState(0);
    const [flaggedPage, setFlaggedPage] = useState(1);
    const [flaggedStatusFilter, setFlaggedStatusFilter] = useState('');
    const [flaggedSenderSearch, setFlaggedSenderSearch] = useState('');
    const [flaggedWordSearch, setFlaggedWordSearch] = useState('');
    const [flaggedDateRange, setFlaggedDateRange] = useState('');
    const [flaggedSort, setFlaggedSort] = useState('newest');

    // === حالة التحديد المتعدد (Bulk) ===
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkActionLoading, setBulkActionLoading] = useState(false);

    // === الإحصائيات ===
    const [stats, setStats] = useState(null);

    // === النوافذ المنبثقة ===
    const [showAddModal, setShowAddModal] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showReviewModal, setShowReviewModal] = useState(false);
    const [selectedWord, setSelectedWord] = useState(null);
    const [selectedFlagged, setSelectedFlagged] = useState(null);
    const [modalLoading, setModalLoading] = useState(false);

    // نموذج إضافة كلمة
    const [newWord, setNewWord] = useState({ word: '', category: 'other', language: 'other' });

    // نموذج الإضافة المتعددة
    const [bulkText, setBulkText] = useState('');
    const [bulkCategory, setBulkCategory] = useState('other');
    const [bulkLanguage, setBulkLanguage] = useState('other');

    // نموذج التعديل
    const [editForm, setEditForm] = useState({ word: '', category: 'other', language: 'other', isActive: true });

    // نموذج المراجعة
    const [reviewAction, setReviewAction] = useState('dismiss');
    const [reviewNotes, setReviewNotes] = useState('');

    const categories = [
        { value: 'sexual', label: 'جنسي' },
        { value: 'violence', label: 'عنف' },
        { value: 'hate', label: 'كراهية' },
        { value: 'spam', label: 'سبام' },
        { value: 'other', label: 'أخرى' }
    ];

    const languages = [
        { value: 'ar', label: 'عربي' },
        { value: 'en', label: 'إنجليزي' },
        { value: 'other', label: 'أخرى' }
    ];

    // ============================
    // جلب الكلمات المحظورة
    // ============================
    const fetchWords = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: wordsPage, limit: 20 });
            if (wordsSearch) params.append('search', wordsSearch);
            if (wordsCategoryFilter) params.append('category', wordsCategoryFilter);
            if (wordsLanguageFilter) params.append('language', wordsLanguageFilter);

            const res = await fetch(`${API_URL}/banned-words?${params}`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) {
                setWords(data.data.words || []);
                setWordsTotal(data.data.pagination?.total || 0);
            }
        } catch (err) {
            console.error('Error fetching words:', err);
        }
        setLoading(false);
    }, [wordsPage, wordsSearch, wordsCategoryFilter, wordsLanguageFilter]);

    // ============================
    // جلب الرسائل المحظورة مع الفلاتر المحسنة
    // ============================
    const fetchFlagged = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: flaggedPage, limit: 20 });
            if (flaggedStatusFilter) params.append('status', flaggedStatusFilter);
            if (flaggedSenderSearch) params.append('senderName', flaggedSenderSearch);
            if (flaggedWordSearch) params.append('matchedWord', flaggedWordSearch);
            if (flaggedDateRange) params.append('dateRange', flaggedDateRange);
            if (flaggedSort) params.append('sort', flaggedSort);

            const res = await fetch(`${API_URL}/banned-words/flagged?${params}`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) {
                setFlagged(data.data.flagged || []);
                setFlaggedTotal(data.data.pagination?.total || 0);
            }
        } catch (err) {
            console.error('Error fetching flagged:', err);
        }
        setLoading(false);
    }, [flaggedPage, flaggedStatusFilter, flaggedSenderSearch, flaggedWordSearch, flaggedDateRange, flaggedSort]);

    // ============================
    // جلب الإحصائيات
    // ============================
    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/banned-words/stats`, { headers: getAuthHeaders() });
            const data = await res.json();
            if (data.success) {
                setStats(data.data);
            }
        } catch (err) {
            console.error('Error fetching stats:', err);
        }
    }, []);

    useEffect(() => {
        fetchWords();
        fetchStats();
    }, [fetchWords, fetchStats]);

    useEffect(() => {
        if (activeTab === 'flagged') {
            fetchFlagged();
        }
    }, [activeTab, fetchFlagged]);

    // مسح التحديد عند تغيير الصفحة أو الفلاتر
    useEffect(() => {
        setSelectedIds(new Set());
    }, [flaggedPage, flaggedStatusFilter, flaggedSenderSearch, flaggedWordSearch, flaggedDateRange, flaggedSort]);

    // ============================
    // إضافة كلمة واحدة
    // ============================
    const handleAddWord = async (e) => {
        e.preventDefault();
        if (!newWord.word.trim()) return;
        setModalLoading(true);
        try {
            const res = await fetch(`${API_URL}/banned-words`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(newWord)
            });
            const data = await res.json();
            if (data.success) {
                setShowAddModal(false);
                setNewWord({ word: '', category: 'other', language: 'other' });
                fetchWords();
                fetchStats();
            } else {
                alert(data.message || 'فشل في إضافة الكلمة');
            }
        } catch (err) {
            alert('خطأ في الاتصال');
        }
        setModalLoading(false);
    };

    // ============================
    // إضافة كلمات متعددة
    // ============================
    const handleBulkImport = async (e) => {
        e.preventDefault();
        if (!bulkText.trim()) return;
        setModalLoading(true);
        try {
            const wordsList = bulkText.split('\n').filter(w => w.trim()).map(w => ({
                word: w.trim(),
                category: bulkCategory,
                language: bulkLanguage
            }));

            const res = await fetch(`${API_URL}/banned-words`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ words: wordsList })
            });
            const data = await res.json();
            if (data.success) {
                setShowBulkModal(false);
                setBulkText('');
                fetchWords();
                fetchStats();
                alert(`تم إضافة ${data.data.added || data.data.length || 0} كلمة`);
            } else {
                alert(data.message || 'فشل في الإضافة');
            }
        } catch (err) {
            alert('خطأ في الاتصال');
        }
        setModalLoading(false);
    };

    // ============================
    // تعديل كلمة
    // ============================
    const handleEditWord = async (e) => {
        e.preventDefault();
        if (!selectedWord) return;
        setModalLoading(true);
        try {
            const res = await fetch(`${API_URL}/banned-words/${selectedWord._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(editForm)
            });
            const data = await res.json();
            if (data.success) {
                setShowEditModal(false);
                setSelectedWord(null);
                fetchWords();
            } else {
                alert(data.message || 'فشل في التحديث');
            }
        } catch (err) {
            alert('خطأ في الاتصال');
        }
        setModalLoading(false);
    };

    // ============================
    // حذف كلمة
    // ============================
    const handleDeleteWord = async () => {
        if (!selectedWord) return;
        setModalLoading(true);
        try {
            const res = await fetch(`${API_URL}/banned-words/${selectedWord._id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (data.success) {
                setShowDeleteConfirm(false);
                setSelectedWord(null);
                fetchWords();
                fetchStats();
            }
        } catch (err) {
            alert('خطأ في الحذف');
        }
        setModalLoading(false);
    };

    // ============================
    // تفعيل/تعطيل كلمة
    // ============================
    const handleToggleActive = async (word) => {
        try {
            const res = await fetch(`${API_URL}/banned-words/${word._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ isActive: !word.isActive })
            });
            const data = await res.json();
            if (data.success) {
                fetchWords();
            }
        } catch (err) {
            console.error('Error toggling:', err);
        }
    };

    // ============================
    // إضافة الكلمات الافتراضية
    // ============================
    const handleSeed = async () => {
        if (!window.confirm('هل تريد إضافة الكلمات المحظورة الافتراضية (عربي + إنجليزي)؟')) return;
        setLoading(true);
        try {
            const res = await fetch(`${API_URL}/banned-words/seed`, {
                method: 'POST',
                headers: getAuthHeaders()
            });
            const data = await res.json();
            if (data.success) {
                alert(`تم إضافة ${data.data.added} كلمة جديدة (${data.data.skipped} موجودة مسبقاً)`);
                fetchWords();
                fetchStats();
            }
        } catch (err) {
            alert('خطأ في إضافة الكلمات الافتراضية');
        }
        setLoading(false);
    };

    // ============================
    // مراجعة رسالة محظورة (مع دعم التعليق/الحظر/الحذف)
    // ============================
    const handleReview = async (e) => {
        e.preventDefault();
        if (!selectedFlagged) return;
        setModalLoading(true);
        try {
            const senderId = selectedFlagged.sender?._id;
            const actionValue = reviewAction;

            // --- تعليق المستخدم ---
            if (SUSPEND_DURATION_MAP[actionValue] && senderId) {
                await fetch(`${API_URL}/users/${senderId}/suspend`, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        duration: SUSPEND_DURATION_MAP[actionValue],
                        reason: reviewNotes || 'مخالفة كلمات محظورة',
                        notify: true
                    })
                });
            }

            // --- حظر نهائي ---
            if (actionValue === 'user_banned' && senderId) {
                await fetch(`${API_URL}/users/${senderId}/ban`, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        reason: reviewNotes || 'مخالفة كلمات محظورة',
                        notify: true
                    })
                });
            }

            // --- حذف الحساب ---
            if (actionValue === 'delete_account' && senderId) {
                await fetch(`${API_URL}/users/${senderId}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });
            }

            // --- تحديث حالة البلاغ ---
            const res = await fetch(`${API_URL}/banned-words/flagged/${selectedFlagged._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: actionValue, notes: reviewNotes })
            });
            const data = await res.json();
            if (data.success) {
                setShowReviewModal(false);
                setSelectedFlagged(null);
                setReviewAction('dismiss');
                setReviewNotes('');
                fetchFlagged();
                fetchStats();
            }
        } catch (err) {
            alert('خطأ في المراجعة');
        }
        setModalLoading(false);
    };

    // ============================
    // إجراءات سريعة: تعليق سريع 24 ساعة
    // ============================
    const handleQuickSuspend = async (item) => {
        if (!item.sender?._id) return;
        if (!window.confirm(`هل تريد تعليق "${item.sender?.name}" لمدة 24 ساعة؟`)) return;
        try {
            await fetch(`${API_URL}/users/${item.sender._id}/suspend`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    duration: '24h',
                    reason: 'مخالفة كلمات محظورة — تعليق سريع',
                    notify: true
                })
            });
            // تحديث حالة البلاغ
            await fetch(`${API_URL}/banned-words/flagged/${item._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: 'user_suspended_24h', notes: 'تعليق سريع 24 ساعة' })
            });
            fetchFlagged();
            fetchStats();
        } catch (err) {
            alert('خطأ في تعليق المستخدم');
        }
    };

    // ============================
    // إجراءات سريعة: حظر نهائي
    // ============================
    const handleQuickBan = async (item) => {
        if (!item.sender?._id) return;
        if (!window.confirm(`هل تريد حظر "${item.sender?.name}" نهائياً؟`)) return;
        try {
            await fetch(`${API_URL}/users/${item.sender._id}/ban`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    reason: 'مخالفة كلمات محظورة — حظر سريع',
                    notify: true
                })
            });
            await fetch(`${API_URL}/banned-words/flagged/${item._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: 'user_banned', notes: 'حظر سريع' })
            });
            fetchFlagged();
            fetchStats();
        } catch (err) {
            alert('خطأ في حظر المستخدم');
        }
    };

    // ============================
    // إجراءات سريعة: رفض (بدون إجراء)
    // ============================
    const handleQuickDismiss = async (item) => {
        try {
            await fetch(`${API_URL}/banned-words/flagged/${item._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: 'dismiss', notes: 'رفض سريع' })
            });
            fetchFlagged();
            fetchStats();
        } catch (err) {
            alert('خطأ في رفض البلاغ');
        }
    };

    // ============================
    // التحديد المتعدد
    // ============================
    const toggleSelectItem = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectedIds.size === flagged.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(flagged.map(f => f._id)));
        }
    };

    // ============================
    // إجراءات جماعية: رفض المحدد
    // ============================
    const handleBulkDismiss = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`هل تريد رفض ${selectedIds.size} بلاغ؟`)) return;
        setBulkActionLoading(true);
        try {
            const promises = Array.from(selectedIds).map(id =>
                fetch(`${API_URL}/banned-words/flagged/${id}`, {
                    method: 'PUT',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ action: 'dismiss', notes: 'رفض جماعي' })
                })
            );
            await Promise.all(promises);
            setSelectedIds(new Set());
            fetchFlagged();
            fetchStats();
        } catch (err) {
            alert('خطأ في الرفض الجماعي');
        }
        setBulkActionLoading(false);
    };

    // ============================
    // إجراءات جماعية: تعليق المحددين 24 ساعة
    // ============================
    const handleBulkSuspend = async () => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`هل تريد تعليق مرسلي ${selectedIds.size} بلاغ لمدة 24 ساعة؟`)) return;
        setBulkActionLoading(true);
        try {
            const selectedItems = flagged.filter(f => selectedIds.has(f._id));
            // جمع المرسلين الفريدين
            const uniqueSenders = new Set();
            const promises = [];

            for (const item of selectedItems) {
                // تعليق المرسل (مرة واحدة لكل مرسل)
                if (item.sender?._id && !uniqueSenders.has(item.sender._id)) {
                    uniqueSenders.add(item.sender._id);
                    promises.push(
                        fetch(`${API_URL}/users/${item.sender._id}/suspend`, {
                            method: 'PUT',
                            headers: getAuthHeaders(),
                            body: JSON.stringify({
                                duration: '24h',
                                reason: 'مخالفة كلمات محظورة — تعليق جماعي',
                                notify: true
                            })
                        })
                    );
                }
                // تحديث حالة البلاغ
                promises.push(
                    fetch(`${API_URL}/banned-words/flagged/${item._id}`, {
                        method: 'PUT',
                        headers: getAuthHeaders(),
                        body: JSON.stringify({ action: 'user_suspended_24h', notes: 'تعليق جماعي 24 ساعة' })
                    })
                );
            }

            await Promise.all(promises);
            setSelectedIds(new Set());
            fetchFlagged();
            fetchStats();
        } catch (err) {
            alert('خطأ في التعليق الجماعي');
        }
        setBulkActionLoading(false);
    };

    // ============================
    // فتح النوافذ المنبثقة
    // ============================
    const openEditModal = (word) => {
        setSelectedWord(word);
        setEditForm({
            word: word.word,
            category: word.category || 'other',
            language: word.language || 'other',
            isActive: word.isActive !== false
        });
        setShowEditModal(true);
    };

    const openDeleteConfirm = (word) => {
        setSelectedWord(word);
        setShowDeleteConfirm(true);
    };

    const openReviewModal = (item) => {
        setSelectedFlagged(item);
        setReviewAction('dismiss');
        setReviewNotes('');
        setShowReviewModal(true);
    };

    // ============================
    // مساعدات العرض
    // ============================
    const getCategoryLabel = (cat) => {
        const found = categories.find(c => c.value === cat);
        return found ? found.label : cat;
    };

    const getLanguageLabel = (lang) => {
        const found = languages.find(l => l.value === lang);
        return found ? found.label : lang;
    };

    const getStatusLabel = (status) => {
        const map = {
            'pending': 'في الانتظار',
            'reviewed': 'تمت المراجعة',
            'dismissed': 'مرفوض',
            'action_taken': 'تم اتخاذ إجراء'
        };
        return map[status] || status;
    };

    const getStatusClass = (status) => {
        const map = {
            'pending': 'status-pending',
            'reviewed': 'status-reviewed',
            'dismissed': 'status-dismissed',
            'action_taken': 'status-action'
        };
        return map[status] || '';
    };

    // لون الصف حسب الحالة
    const getRowClass = (item) => {
        if (item.status === 'pending') return 'bw-row-pending';
        if (item.status === 'action_taken') return 'bw-row-action-taken';
        if (item.status === 'dismissed') return 'bw-row-dismissed';
        return '';
    };

    // تسمية الإجراء المتخذ
    const getActionLabel = (action) => {
        const found = REVIEW_ACTIONS.find(a => a.value === action);
        if (found) return found.label;
        const legacyMap = {
            'none': 'تم التجاهل',
            'warning': 'تم التحذير',
            'message_deleted': 'تم حذف الرسالة',
            'user_suspended': 'تم الإيقاف',
            'user_banned': 'تم الحظر',
            'dismiss': 'تم الرفض',
        };
        return legacyMap[action] || action;
    };

    return (
        <div className="banned-words-page">
            {/* ======= بطاقات الإحصائيات ======= */}
            {stats && (
                <div className="bw-stats-grid">
                    <div className="bw-stat-card">
                        <div className="bw-stat-icon">📝</div>
                        <div className="bw-stat-info">
                            <span className="bw-stat-number">{stats.totalWords || 0}</span>
                            <span className="bw-stat-label">إجمالي الكلمات</span>
                        </div>
                    </div>
                    <div className="bw-stat-card">
                        <div className="bw-stat-icon active-icon">✅</div>
                        <div className="bw-stat-info">
                            <span className="bw-stat-number">{stats.activeWords || 0}</span>
                            <span className="bw-stat-label">كلمات مفعلة</span>
                        </div>
                    </div>
                    <div className="bw-stat-card warning">
                        <div className="bw-stat-icon">⚠️</div>
                        <div className="bw-stat-info">
                            <span className="bw-stat-number">{stats.flaggedMessages?.pending || 0}</span>
                            <span className="bw-stat-label">بانتظار المراجعة</span>
                        </div>
                    </div>
                    <div className="bw-stat-card danger">
                        <div className="bw-stat-icon">🚫</div>
                        <div className="bw-stat-info">
                            <span className="bw-stat-number">{stats.flaggedMessages?.total || 0}</span>
                            <span className="bw-stat-label">رسائل محظورة</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ======= أكثر المخالفين + اتجاه المخالفات ======= */}
            {stats && (stats.topViolators?.length > 0 || stats.violationTrend) && (
                <div className="bw-extra-stats">
                    {stats.topViolators?.length > 0 && (
                        <div className="bw-top-violators-card">
                            <h4 className="bw-extra-stats-title">🔥 أكثر المخالفين</h4>
                            <div className="bw-violators-list">
                                {stats.topViolators.slice(0, 3).map((v, i) => (
                                    <div key={v._id || i} className="bw-violator-item">
                                        <span className="bw-violator-rank">#{i + 1}</span>
                                        <span
                                            className="bw-violator-name clickable"
                                            onClick={() => v._id && onViewUserDetail && onViewUserDetail(v._id)}
                                        >
                                            {v.name || v.senderName || 'مجهول'}
                                        </span>
                                        <span className="bw-violator-count">{v.count || v.violations || 0} مخالفة</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {stats.violationTrend && (
                        <div className="bw-trend-card">
                            <h4 className="bw-extra-stats-title">📈 اتجاه المخالفات</h4>
                            <p className="bw-trend-text">
                                {stats.violationTrend.direction === 'up'
                                    ? `ارتفاع ${stats.violationTrend.percentage || ''}% مقارنة بالفترة السابقة`
                                    : stats.violationTrend.direction === 'down'
                                    ? `انخفاض ${stats.violationTrend.percentage || ''}% مقارنة بالفترة السابقة`
                                    : 'مستقر مقارنة بالفترة السابقة'}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* ======= التبويبات ======= */}
            <div className="bw-tabs">
                <button
                    className={`bw-tab ${activeTab === 'words' ? 'active' : ''}`}
                    onClick={() => setActiveTab('words')}
                >
                    📝 الكلمات المحظورة
                </button>
                <button
                    className={`bw-tab ${activeTab === 'flagged' ? 'active' : ''}`}
                    onClick={() => setActiveTab('flagged')}
                >
                    ⚠️ رسائل للمراجعة
                    {stats?.flaggedMessages?.pending > 0 && (
                        <span className="bw-tab-badge">{stats.flaggedMessages.pending}</span>
                    )}
                </button>
                <button
                    className={`bw-tab ${activeTab === 'external-promo' ? 'active' : ''}`}
                    onClick={() => setActiveTab('external-promo')}
                >
                    🚫 الترويج الخارجي
                </button>
            </div>

            {activeTab === 'external-promo' && (
                <ExternalPromoTab onViewUserDetail={onViewUserDetail} />
            )}

            {/* ======================================================== */}
            {/* ======= تبويب الكلمات المحظورة ======= */}
            {/* ======================================================== */}
            {activeTab === 'words' && (
                <div className="bw-section">
                    {/* شريط الإجراءات */}
                    <div className="bw-actions-bar">
                        <div className="bw-search-group">
                            <input
                                type="text"
                                placeholder="بحث عن كلمة..."
                                value={wordsSearch}
                                onChange={(e) => { setWordsSearch(e.target.value); setWordsPage(1); }}
                                className="bw-search-input"
                            />
                            <select
                                value={wordsCategoryFilter}
                                onChange={(e) => { setWordsCategoryFilter(e.target.value); setWordsPage(1); }}
                                className="bw-filter-select"
                            >
                                <option value="">كل التصنيفات</option>
                                {categories.map(c => (
                                    <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                            </select>
                            <select
                                value={wordsLanguageFilter}
                                onChange={(e) => { setWordsLanguageFilter(e.target.value); setWordsPage(1); }}
                                className="bw-filter-select"
                            >
                                <option value="">كل اللغات</option>
                                {languages.map(l => (
                                    <option key={l.value} value={l.value}>{l.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="bw-btn-group">
                            <button className="bw-btn primary" onClick={() => setShowAddModal(true)}>
                                + إضافة كلمة
                            </button>
                            <button className="bw-btn secondary" onClick={() => setShowBulkModal(true)}>
                                📋 إضافة متعددة
                            </button>
                            <button className="bw-btn warning" onClick={handleSeed}>
                                🌱 كلمات افتراضية
                            </button>
                        </div>
                    </div>

                    {/* جدول الكلمات */}
                    {loading ? (
                        <LoadingSpinner />
                    ) : words.length === 0 ? (
                        <div className="bw-empty">
                            <span className="bw-empty-icon">📝</span>
                            <p>لا توجد كلمات محظورة</p>
                            <button className="bw-btn primary" onClick={handleSeed}>إضافة كلمات افتراضية</button>
                        </div>
                    ) : (
                        <>
                            <div className="bw-table-container">
                                <table className="bw-table">
                                    <thead>
                                        <tr>
                                            <th>الكلمة</th>
                                            <th>التصنيف</th>
                                            <th>اللغة</th>
                                            <th>الحالة</th>
                                            <th>التاريخ</th>
                                            <th>إجراءات</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {words.map((word) => (
                                            <tr key={word._id} className={!word.isActive ? 'inactive-row' : ''}>
                                                <td className="word-cell">
                                                    <span className="word-text">{word.word}</span>
                                                </td>
                                                <td>
                                                    <span className={`bw-badge category-${word.category}`}>
                                                        {getCategoryLabel(word.category)}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="bw-badge language">
                                                        {getLanguageLabel(word.language)}
                                                    </span>
                                                </td>
                                                <td>
                                                    <button
                                                        className={`bw-toggle ${word.isActive ? 'active' : 'inactive'}`}
                                                        onClick={() => handleToggleActive(word)}
                                                        title={word.isActive ? 'تعطيل' : 'تفعيل'}
                                                    >
                                                        {word.isActive ? '🟢 مفعل' : '🔴 معطل'}
                                                    </button>
                                                </td>
                                                <td className="date-cell">
                                                    {new Date(word.createdAt).toLocaleDateString('ar-SA')}
                                                </td>
                                                <td>
                                                    <div className="bw-action-btns">
                                                        <button
                                                            className="bw-icon-btn edit"
                                                            onClick={() => openEditModal(word)}
                                                            title="تعديل"
                                                        >
                                                            ✏️
                                                        </button>
                                                        <button
                                                            className="bw-icon-btn delete"
                                                            onClick={() => openDeleteConfirm(word)}
                                                            title="حذف"
                                                        >
                                                            🗑️
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {wordsTotal > 20 && (
                                <Pagination
                                    currentPage={wordsPage}
                                    totalPages={Math.ceil(wordsTotal / 20)}
                                    onPageChange={setWordsPage}
                                />
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ======================================================== */}
            {/* ======= تبويب الرسائل المحظورة (محسّن) ======= */}
            {/* ======================================================== */}
            {activeTab === 'flagged' && (
                <div className="bw-section">
                    {/* --- فلاتر محسنة --- */}
                    <div className="bw-actions-bar bw-flagged-filters">
                        <div className="bw-search-group bw-search-group-wide">
                            <input
                                type="text"
                                placeholder="🔍 بحث باسم المرسل..."
                                value={flaggedSenderSearch}
                                onChange={(e) => { setFlaggedSenderSearch(e.target.value); setFlaggedPage(1); }}
                                className="bw-search-input"
                            />
                            <input
                                type="text"
                                placeholder="🔍 بحث بالكلمة المطابقة..."
                                value={flaggedWordSearch}
                                onChange={(e) => { setFlaggedWordSearch(e.target.value); setFlaggedPage(1); }}
                                className="bw-search-input"
                            />
                            <select
                                value={flaggedStatusFilter}
                                onChange={(e) => { setFlaggedStatusFilter(e.target.value); setFlaggedPage(1); }}
                                className="bw-filter-select"
                            >
                                <option value="">كل الحالات</option>
                                <option value="pending">في الانتظار</option>
                                <option value="reviewed">تمت المراجعة</option>
                                <option value="dismissed">مرفوض</option>
                                <option value="action_taken">تم اتخاذ إجراء</option>
                            </select>
                            <select
                                value={flaggedDateRange}
                                onChange={(e) => { setFlaggedDateRange(e.target.value); setFlaggedPage(1); }}
                                className="bw-filter-select"
                            >
                                <option value="">كل الأوقات</option>
                                <option value="today">اليوم</option>
                                <option value="7days">آخر 7 أيام</option>
                                <option value="30days">آخر 30 يوم</option>
                            </select>
                            <select
                                value={flaggedSort}
                                onChange={(e) => { setFlaggedSort(e.target.value); setFlaggedPage(1); }}
                                className="bw-filter-select"
                            >
                                <option value="newest">الأحدث أولاً</option>
                                <option value="oldest">الأقدم أولاً</option>
                            </select>
                        </div>
                    </div>

                    {/* --- شريط الإجراءات الجماعية --- */}
                    {selectedIds.size > 0 && (
                        <div className="bw-bulk-action-bar">
                            <span className="bw-bulk-count">تم تحديد {selectedIds.size} بلاغ</span>
                            <button
                                className="bw-btn secondary small"
                                onClick={handleBulkDismiss}
                                disabled={bulkActionLoading}
                            >
                                ✅ رفض المحدد
                            </button>
                            <button
                                className="bw-btn warning small"
                                onClick={handleBulkSuspend}
                                disabled={bulkActionLoading}
                            >
                                ⏸️ تعليق المحددين (24 ساعة)
                            </button>
                            {bulkActionLoading && <span className="bw-bulk-loading">جاري التنفيذ...</span>}
                        </div>
                    )}

                    {loading ? (
                        <LoadingSpinner />
                    ) : flagged.length === 0 ? (
                        <div className="bw-empty">
                            <span className="bw-empty-icon">✅</span>
                            <p>لا توجد رسائل للمراجعة</p>
                        </div>
                    ) : (
                        <>
                            <div className="bw-table-container">
                                <table className="bw-table bw-flagged-table">
                                    <thead>
                                        <tr>
                                            <th className="bw-checkbox-col">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.size === flagged.length && flagged.length > 0}
                                                    onChange={toggleSelectAll}
                                                    title="تحديد الكل"
                                                />
                                            </th>
                                            <th>المرسل</th>
                                            <th>المستقبل</th>
                                            <th>المحتوى الأصلي</th>
                                            <th>الكلمات المطابقة</th>
                                            <th>الحالة</th>
                                            <th>الوقت</th>
                                            <th>إجراءات سريعة</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {flagged.map((item) => (
                                            <tr key={item._id} className={getRowClass(item)}>
                                                {/* خانة التحديد */}
                                                <td className="bw-checkbox-col">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedIds.has(item._id)}
                                                        onChange={() => toggleSelectItem(item._id)}
                                                    />
                                                </td>

                                                {/* المرسل + شارة المخالفات */}
                                                <td>
                                                    <div className="bw-sender">
                                                        <span
                                                            className="sender-name clickable"
                                                            onClick={() => item.sender?._id && onViewUserDetail && onViewUserDetail(item.sender._id)}
                                                            title="عرض الملف الشخصي"
                                                        >
                                                            👤 {item.sender?.name || 'مجهول'}
                                                        </span>
                                                        {(item.sender?.violationCount || item.senderViolationCount) > 0 && (
                                                            <span className="bw-violation-badge" title="عدد المخالفات">
                                                                {item.sender?.violationCount || item.senderViolationCount}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* المستقبل */}
                                                <td>
                                                    <div className="bw-sender">
                                                        <span
                                                            className="sender-name clickable"
                                                            onClick={() => item.receiver?._id && onViewUserDetail && onViewUserDetail(item.receiver._id)}
                                                            title="عرض الملف الشخصي"
                                                        >
                                                            👤 {item.receiver?.name || 'مجهول'}
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* المحتوى */}
                                                <td className="content-cell">
                                                    <span className="flagged-content">{item.originalContent}</span>
                                                </td>

                                                {/* الكلمات المطابقة */}
                                                <td>
                                                    <div className="matched-words">
                                                        {(item.matchedWords || []).map((w, i) => (
                                                            <span key={i} className="bw-badge danger">{w}</span>
                                                        ))}
                                                    </div>
                                                </td>

                                                {/* الحالة */}
                                                <td>
                                                    <span className={`bw-status ${getStatusClass(item.status)}`}>
                                                        {getStatusLabel(item.status)}
                                                    </span>
                                                </td>

                                                {/* الوقت (منذ ...) */}
                                                <td className="date-cell" title={new Date(item.createdAt).toLocaleString('ar-SA')}>
                                                    {timeAgo(item.createdAt)}
                                                </td>

                                                {/* إجراءات سريعة */}
                                                <td>
                                                    <div className="bw-quick-actions">
                                                        {/* عرض المرسل */}
                                                        <button
                                                            className="bw-quick-btn bw-quick-view"
                                                            onClick={() => item.sender?._id && onViewUserDetail && onViewUserDetail(item.sender._id)}
                                                            title="عرض المرسل"
                                                        >
                                                            👤
                                                        </button>

                                                        {/* عرض المحادثة */}
                                                        {item.conversation && (
                                                            <button
                                                                className="bw-quick-btn bw-quick-review"
                                                                onClick={() => onViewConversation && onViewConversation(item.conversation)}
                                                                title="عرض المحادثة"
                                                            >
                                                                💬
                                                            </button>
                                                        )}

                                                        {/* تعليق سريع 24h */}
                                                        {item.status === 'pending' && (
                                                            <button
                                                                className="bw-quick-btn bw-quick-suspend"
                                                                onClick={() => handleQuickSuspend(item)}
                                                                title="تعليق سريع (24 ساعة)"
                                                            >
                                                                ⏸️
                                                            </button>
                                                        )}

                                                        {/* حظر */}
                                                        {item.status === 'pending' && (
                                                            <button
                                                                className="bw-quick-btn bw-quick-ban"
                                                                onClick={() => handleQuickBan(item)}
                                                                title="حظر نهائي"
                                                            >
                                                                🚫
                                                            </button>
                                                        )}

                                                        {/* رفض */}
                                                        {item.status === 'pending' && (
                                                            <button
                                                                className="bw-quick-btn bw-quick-dismiss"
                                                                onClick={() => handleQuickDismiss(item)}
                                                                title="رفض (بدون إجراء)"
                                                            >
                                                                ✅
                                                            </button>
                                                        )}

                                                        {/* مراجعة كاملة */}
                                                        {item.status === 'pending' ? (
                                                            <button
                                                                className="bw-quick-btn bw-quick-review"
                                                                onClick={() => openReviewModal(item)}
                                                                title="مراجعة كاملة"
                                                            >
                                                                📋
                                                            </button>
                                                        ) : (
                                                            <span className="bw-reviewed-label">
                                                                {getActionLabel(item.action)}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {flaggedTotal > 20 && (
                                <Pagination
                                    currentPage={flaggedPage}
                                    totalPages={Math.ceil(flaggedTotal / 20)}
                                    onPageChange={setFlaggedPage}
                                />
                            )}
                        </>
                    )}
                </div>
            )}

            {/* ======================================================== */}
            {/* ======= نافذة إضافة كلمة ======= */}
            {/* ======================================================== */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="bw-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="bw-modal-header">
                            <h3>إضافة كلمة محظورة</h3>
                            <button className="bw-close-btn" onClick={() => setShowAddModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleAddWord}>
                            <div className="bw-form-group">
                                <label>الكلمة</label>
                                <input
                                    type="text"
                                    value={newWord.word}
                                    onChange={(e) => setNewWord({ ...newWord, word: e.target.value })}
                                    placeholder="أدخل الكلمة المحظورة"
                                    required
                                />
                            </div>
                            <div className="bw-form-row">
                                <div className="bw-form-group">
                                    <label>التصنيف</label>
                                    <select
                                        value={newWord.category}
                                        onChange={(e) => setNewWord({ ...newWord, category: e.target.value })}
                                    >
                                        {categories.map(c => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="bw-form-group">
                                    <label>اللغة</label>
                                    <select
                                        value={newWord.language}
                                        onChange={(e) => setNewWord({ ...newWord, language: e.target.value })}
                                    >
                                        {languages.map(l => (
                                            <option key={l.value} value={l.value}>{l.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="bw-modal-actions">
                                <button type="button" className="bw-btn cancel" onClick={() => setShowAddModal(false)}>إلغاء</button>
                                <button type="submit" className="bw-btn primary" disabled={modalLoading}>
                                    {modalLoading ? 'جاري الإضافة...' : 'إضافة'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ======================================================== */}
            {/* ======= نافذة الإضافة المتعددة ======= */}
            {/* ======================================================== */}
            {showBulkModal && (
                <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
                    <div className="bw-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="bw-modal-header">
                            <h3>إضافة كلمات متعددة</h3>
                            <button className="bw-close-btn" onClick={() => setShowBulkModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleBulkImport}>
                            <div className="bw-form-group">
                                <label>الكلمات (كلمة في كل سطر)</label>
                                <textarea
                                    value={bulkText}
                                    onChange={(e) => setBulkText(e.target.value)}
                                    placeholder="كلمة 1&#10;كلمة 2&#10;كلمة 3"
                                    rows={8}
                                    required
                                />
                            </div>
                            <div className="bw-form-row">
                                <div className="bw-form-group">
                                    <label>التصنيف</label>
                                    <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)}>
                                        {categories.map(c => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="bw-form-group">
                                    <label>اللغة</label>
                                    <select value={bulkLanguage} onChange={(e) => setBulkLanguage(e.target.value)}>
                                        {languages.map(l => (
                                            <option key={l.value} value={l.value}>{l.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="bw-modal-actions">
                                <button type="button" className="bw-btn cancel" onClick={() => setShowBulkModal(false)}>إلغاء</button>
                                <button type="submit" className="bw-btn primary" disabled={modalLoading}>
                                    {modalLoading ? 'جاري الإضافة...' : 'إضافة الكل'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ======================================================== */}
            {/* ======= نافذة تعديل كلمة ======= */}
            {/* ======================================================== */}
            {showEditModal && (
                <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
                    <div className="bw-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="bw-modal-header">
                            <h3>تعديل كلمة محظورة</h3>
                            <button className="bw-close-btn" onClick={() => setShowEditModal(false)}>✕</button>
                        </div>
                        <form onSubmit={handleEditWord}>
                            <div className="bw-form-group">
                                <label>الكلمة</label>
                                <input
                                    type="text"
                                    value={editForm.word}
                                    onChange={(e) => setEditForm({ ...editForm, word: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="bw-form-row">
                                <div className="bw-form-group">
                                    <label>التصنيف</label>
                                    <select
                                        value={editForm.category}
                                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                    >
                                        {categories.map(c => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="bw-form-group">
                                    <label>اللغة</label>
                                    <select
                                        value={editForm.language}
                                        onChange={(e) => setEditForm({ ...editForm, language: e.target.value })}
                                    >
                                        {languages.map(l => (
                                            <option key={l.value} value={l.value}>{l.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="bw-form-group">
                                <label className="bw-checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={editForm.isActive}
                                        onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                                    />
                                    مفعل
                                </label>
                            </div>
                            <div className="bw-modal-actions">
                                <button type="button" className="bw-btn cancel" onClick={() => setShowEditModal(false)}>إلغاء</button>
                                <button type="submit" className="bw-btn primary" disabled={modalLoading}>
                                    {modalLoading ? 'جاري التحديث...' : 'تحديث'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ======= تأكيد حذف كلمة ======= */}
            {showDeleteConfirm && (
                <ConfirmModal
                    title="حذف كلمة محظورة"
                    message={`هل تريد حذف الكلمة "${selectedWord?.word}"؟`}
                    onConfirm={handleDeleteWord}
                    onCancel={() => { setShowDeleteConfirm(false); setSelectedWord(null); }}
                    loading={modalLoading}
                    confirmText="حذف"
                    cancelText="إلغاء"
                    type="danger"
                />
            )}

            {/* ======================================================== */}
            {/* ======= نافذة المراجعة الكاملة (محسّنة) ======= */}
            {/* ======================================================== */}
            {showReviewModal && selectedFlagged && (
                <div className="modal-overlay" onClick={() => setShowReviewModal(false)}>
                    <div className="bw-modal review-modal bw-review-enhanced" onClick={(e) => e.stopPropagation()}>
                        <div className="bw-modal-header">
                            <h3>📋 مراجعة رسالة محظورة</h3>
                            <button className="bw-close-btn" onClick={() => setShowReviewModal(false)}>✕</button>
                        </div>

                        <div className="review-details">
                            {/* معلومات المرسل */}
                            <div className="review-info-row">
                                <span className="review-label">👤 المرسل:</span>
                                <span className="review-value">
                                    <span
                                        className="clickable bw-review-link"
                                        onClick={() => selectedFlagged.sender?._id && onViewUserDetail && onViewUserDetail(selectedFlagged.sender._id)}
                                    >
                                        {selectedFlagged.sender?.name || 'مجهول'}
                                    </span>
                                    {(selectedFlagged.sender?.violationCount || selectedFlagged.senderViolationCount) > 0 && (
                                        <span className="bw-violation-badge bw-violation-badge-lg">
                                            {selectedFlagged.sender?.violationCount || selectedFlagged.senderViolationCount} مخالفة
                                        </span>
                                    )}
                                    {selectedFlagged.sender?.status && selectedFlagged.sender.status !== 'active' && (
                                        <span className="bw-user-status-badge">
                                            {selectedFlagged.sender.status === 'suspended' ? '⏸️ معلق' :
                                             selectedFlagged.sender.status === 'banned' ? '🚫 محظور' :
                                             selectedFlagged.sender.status}
                                        </span>
                                    )}
                                </span>
                            </div>

                            {/* معلومات المستقبل */}
                            <div className="review-info-row">
                                <span className="review-label">👤 المستقبل:</span>
                                <span className="review-value">
                                    <span
                                        className="clickable bw-review-link"
                                        onClick={() => selectedFlagged.receiver?._id && onViewUserDetail && onViewUserDetail(selectedFlagged.receiver._id)}
                                    >
                                        {selectedFlagged.receiver?.name || 'مجهول'}
                                    </span>
                                </span>
                            </div>

                            {/* رابط المحادثة */}
                            {selectedFlagged.conversation && (
                                <div className="review-info-row">
                                    <span className="review-label">💬 المحادثة:</span>
                                    <span className="review-value">
                                        <button
                                            className="bw-btn secondary small bw-inline-btn"
                                            onClick={() => onViewConversation && onViewConversation(selectedFlagged.conversation)}
                                        >
                                            💬 عرض المحادثة
                                        </button>
                                    </span>
                                </div>
                            )}

                            {/* تاريخ ووقت الرسالة */}
                            <div className="review-info-row">
                                <span className="review-label">🕐 الوقت:</span>
                                <span className="review-value">
                                    {new Date(selectedFlagged.createdAt).toLocaleString('ar-SA', {
                                        year: 'numeric', month: 'long', day: 'numeric',
                                        hour: '2-digit', minute: '2-digit'
                                    })}
                                    <span className="bw-time-ago">({timeAgo(selectedFlagged.createdAt)})</span>
                                </span>
                            </div>

                            {/* المحتوى الأصلي */}
                            <div className="review-info-row">
                                <span className="review-label">📄 المحتوى الأصلي:</span>
                                <span className="review-value flagged-text bw-content-box">
                                    {selectedFlagged.originalContent}
                                </span>
                            </div>

                            {/* الكلمات المطابقة */}
                            <div className="review-info-row">
                                <span className="review-label">🔤 الكلمات المطابقة:</span>
                                <div className="matched-words">
                                    {(selectedFlagged.matchedWords || []).map((w, i) => (
                                        <span key={i} className="bw-badge danger">{w}</span>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* نموذج الإجراء */}
                        <form onSubmit={handleReview}>
                            <div className="bw-form-group">
                                <label>الإجراء</label>
                                <select
                                    value={reviewAction}
                                    onChange={(e) => setReviewAction(e.target.value)}
                                    className="bw-review-action-select"
                                >
                                    {REVIEW_ACTIONS.map(a => (
                                        <option key={a.value} value={a.value}>
                                            {a.icon} {a.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="bw-form-group">
                                <label>ملاحظات (اختياري)</label>
                                <textarea
                                    value={reviewNotes}
                                    onChange={(e) => setReviewNotes(e.target.value)}
                                    placeholder="ملاحظات المراجعة..."
                                    rows={3}
                                />
                            </div>

                            {/* تحذير عند اختيار إجراء خطير */}
                            {(reviewAction === 'user_banned' || reviewAction === 'delete_account') && (
                                <div className="bw-review-warning">
                                    ⚠️ {reviewAction === 'delete_account'
                                        ? 'سيتم حذف حساب المستخدم نهائياً! هذا الإجراء لا يمكن التراجع عنه.'
                                        : 'سيتم حظر المستخدم نهائياً من التطبيق.'}
                                </div>
                            )}

                            <div className="bw-modal-actions">
                                <button type="button" className="bw-btn cancel" onClick={() => setShowReviewModal(false)}>إلغاء</button>
                                <button
                                    type="submit"
                                    className={`bw-btn ${(reviewAction === 'user_banned' || reviewAction === 'delete_account') ? 'danger' : 'primary'}`}
                                    disabled={modalLoading}
                                >
                                    {modalLoading ? 'جاري المراجعة...' : 'تأكيد المراجعة'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════
// External Promo Analytics Tab
// ═══════════════════════════════════════════════════════════════
function ExternalPromoTab({ onViewUserDetail }) {
    const [stats, setStats] = useState(null);
    const [offenders, setOffenders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState(30);

    useEffect(() => {
        loadData();
        // eslint-disable-next-line
    }, [days]);

    const loadData = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Authorization': `Bearer ${token}` };

            const [statsRes, offendersRes] = await Promise.all([
                fetch(`/api/banned-words/external-promo/stats?days=${days}`, { headers }).then(r => r.json()),
                fetch(`/api/banned-words/external-promo/top-offenders?days=${days}&limit=20`, { headers }).then(r => r.json())
            ]);
            if (statsRes.success) setStats(statsRes.data);
            if (offendersRes.success) setOffenders(offendersRes.data.offenders || []);
        } catch (e) {
            console.error('promo stats fetch failed', e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="bw-section" style={{padding:'40px',textAlign:'center'}}>جارِ التحميل...</div>;
    if (!stats) return <div className="bw-section" style={{padding:'40px',textAlign:'center'}}>تعذر التحميل</div>;

    const platformColors = {
        snap: '#FFC107', instagram: '#E91E63', whatsapp: '#25D366',
        zinji: '#FF5722', telegram: '#0088CC', tiktok: '#000',
        discord: '#5865F2', phone: '#9C27B0', email: '#607D8B',
        twitter: '#1DA1F2', kik: '#7AAA00'
    };
    const sourceLabels = { bio: '📝 النبذة', message: '💬 الرسائل', name: '👤 الاسم' };
    const sourceColors = { bio: '#FF9800', message: '#2196F3', name: '#9C27B0' };
    const totalCategoryCount = stats.byCategory.reduce((s, c) => s + c.count, 0);
    const totalSourceCount = stats.bySource.reduce((s, c) => s + c.count, 0);

    return (
        <div className="bw-section" style={{padding:'20px'}}>
            {/* فلتر الفترة */}
            <div style={{display:'flex',gap:'8px',marginBottom:'20px',alignItems:'center'}}>
                <span style={{fontWeight:'600'}}>الفترة:</span>
                {[7, 30, 90].map(d => (
                    <button key={d}
                        onClick={() => setDays(d)}
                        style={{
                            padding:'6px 14px',
                            borderRadius:'8px',
                            border: days === d ? '2px solid #E91E63' : '1px solid #ddd',
                            background: days === d ? '#FCE4EC' : '#fff',
                            cursor:'pointer',
                            fontSize:'13px'
                        }}>
                        {d} يوم
                    </button>
                ))}
                <button onClick={loadData}
                    style={{marginRight:'auto',padding:'6px 14px',borderRadius:'8px',border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:'13px'}}>
                    🔄 تحديث
                </button>
            </div>

            {/* Hero stats */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:'12px',marginBottom:'20px'}}>
                <StatCard label="إجمالي المحاولات" value={stats.totalAttempts} icon="🚫" color="#E91E63" />
                <StatCard label="مستخدمون فريدون" value={stats.uniqueUsers} icon="👥" color="#2196F3" />
                <StatCard label="المنصة الأكثر استهدافاً"
                    value={stats.byCategory[0]?._id || '—'} subValue={stats.byCategory[0]?.count + ' محاولة'}
                    icon="🎯" color="#FF9800" />
                <StatCard label="المصدر الأبرز"
                    value={sourceLabels[stats.bySource[0]?._id] || '—'} subValue={stats.bySource[0]?.count + ' محاولة'}
                    icon="📍" color="#9C27B0" />
            </div>

            {/* Charts row */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'16px',marginBottom:'20px'}}>
                {/* By Category bars */}
                <div style={{background:'#fff',borderRadius:'12px',padding:'16px',boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
                    <h4 style={{margin:'0 0 12px'}}>📊 المنصات الأكثر استهدافاً</h4>
                    {stats.byCategory.slice(0, 8).map(c => {
                        const pct = totalCategoryCount > 0 ? (c.count / totalCategoryCount * 100) : 0;
                        return (
                            <div key={c._id} style={{marginBottom:'10px'}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px',fontSize:'13px'}}>
                                    <span style={{fontWeight:'600'}}>{c._id}</span>
                                    <span>{c.count} ({pct.toFixed(0)}%)</span>
                                </div>
                                <div style={{height:'8px',background:'#f0f0f0',borderRadius:'4px',overflow:'hidden'}}>
                                    <div style={{
                                        width: pct + '%',
                                        height:'100%',
                                        background: platformColors[c._id] || '#999',
                                        borderRadius:'4px',
                                        transition:'width 0.4s'
                                    }} />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* By Source bars */}
                <div style={{background:'#fff',borderRadius:'12px',padding:'16px',boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
                    <h4 style={{margin:'0 0 12px'}}>📍 المصدر</h4>
                    {stats.bySource.map(s => {
                        const pct = totalSourceCount > 0 ? (s.count / totalSourceCount * 100) : 0;
                        return (
                            <div key={s._id} style={{marginBottom:'12px'}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px',fontSize:'13px'}}>
                                    <span style={{fontWeight:'600'}}>{sourceLabels[s._id] || s._id}</span>
                                    <span>{s.count} ({pct.toFixed(0)}%)</span>
                                </div>
                                <div style={{height:'10px',background:'#f0f0f0',borderRadius:'5px',overflow:'hidden'}}>
                                    <div style={{
                                        width: pct + '%',
                                        height:'100%',
                                        background: sourceColors[s._id] || '#999',
                                        borderRadius:'5px',
                                        transition:'width 0.4s'
                                    }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Daily trend */}
            {stats.dailyTrend?.length > 0 && (
                <div style={{background:'#fff',borderRadius:'12px',padding:'16px',marginBottom:'20px',boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
                    <h4 style={{margin:'0 0 12px'}}>📈 الاتجاه اليومي (آخر 7 أيام)</h4>
                    <div style={{display:'flex',alignItems:'flex-end',gap:'8px',height:'120px',padding:'8px 0'}}>
                        {stats.dailyTrend.map(d => {
                            const max = Math.max(...stats.dailyTrend.map(x => x.count), 1);
                            const h = (d.count / max * 100);
                            return (
                                <div key={d._id} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:'4px'}}>
                                    <div style={{fontSize:'11px',color:'#666'}}>{d.count}</div>
                                    <div style={{
                                        width:'100%',
                                        height: h + '%',
                                        minHeight:'4px',
                                        background:'linear-gradient(180deg, #E91E63, #9C27B0)',
                                        borderRadius:'4px 4px 0 0'
                                    }} />
                                    <div style={{fontSize:'10px',color:'#999',direction:'ltr'}}>{d._id.slice(5)}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Top offenders */}
            <div style={{background:'#fff',borderRadius:'12px',padding:'16px',boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
                <h4 style={{margin:'0 0 12px'}}>🏆 أكثر المخالفين</h4>
                {offenders.length === 0 ? (
                    <p style={{textAlign:'center',color:'#999',padding:'20px'}}>لا يوجد بيانات في هذه الفترة</p>
                ) : (
                    <div style={{maxHeight:'400px',overflowY:'auto'}}>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                            <thead><tr style={{background:'#f5f5f5',textAlign:'right',position:'sticky',top:0}}>
                                <th style={{padding:'8px'}}>#</th>
                                <th style={{padding:'8px'}}>الاسم</th>
                                <th style={{padding:'8px'}}>المحاولات</th>
                                <th style={{padding:'8px'}}>المنصات</th>
                                <th style={{padding:'8px'}}>المصدر</th>
                                <th style={{padding:'8px'}}>آخر محاولة</th>
                                <th style={{padding:'8px'}}></th>
                            </tr></thead>
                            <tbody>
                                {offenders.map((o, i) => (
                                    <tr key={o._id} style={{borderBottom:'1px solid #eee'}}>
                                        <td style={{padding:'8px'}}>{i + 1}</td>
                                        <td style={{padding:'8px',fontWeight:'600'}}>
                                            {o.name}
                                            {o.isPremium && <span style={{marginRight:'6px'}}>👑</span>}
                                        </td>
                                        <td style={{padding:'8px'}}>
                                            <span style={{
                                                background: o.attempts >= 10 ? '#f44336' : o.attempts >= 5 ? '#FF9800' : '#FFC107',
                                                color:'#fff',padding:'2px 8px',borderRadius:'12px',fontSize:'11px'
                                            }}>{o.attempts}</span>
                                        </td>
                                        <td style={{padding:'8px',fontSize:'11px'}}>{(o.categories || []).join(', ')}</td>
                                        <td style={{padding:'8px',fontSize:'11px'}}>{(o.sources || []).map(s => sourceLabels[s] || s).join(', ')}</td>
                                        <td style={{padding:'8px',direction:'ltr',fontSize:'11px'}}>
                                            {o.lastAt ? new Date(o.lastAt).toLocaleString('ar-SA') : '—'}
                                        </td>
                                        <td style={{padding:'8px'}}>
                                            {onViewUserDetail && (
                                                <button onClick={() => onViewUserDetail(o._id)}
                                                    style={{padding:'4px 10px',borderRadius:'6px',border:'1px solid #E91E63',background:'#fff',color:'#E91E63',cursor:'pointer',fontSize:'12px'}}>
                                                    عرض
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function StatCard({ label, value, subValue, icon, color }) {
    return (
        <div style={{
            background:'#fff',
            borderRadius:'12px',
            padding:'16px',
            boxShadow:'0 1px 4px rgba(0,0,0,0.06)',
            borderRight: `4px solid ${color}`
        }}>
            <div style={{fontSize:'12px',color:'#666',marginBottom:'4px'}}>{label}</div>
            <div style={{fontSize:'22px',fontWeight:'700',display:'flex',alignItems:'center',gap:'8px'}}>
                <span>{icon}</span>
                <span>{value}</span>
            </div>
            {subValue && <div style={{fontSize:'11px',color:'#999',marginTop:'4px'}}>{subValue}</div>}
        </div>
    );
}

export default BannedWords;

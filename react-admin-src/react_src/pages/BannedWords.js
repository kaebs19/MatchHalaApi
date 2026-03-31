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

function BannedWords({ onViewUserDetail, onViewConversation }) {
    const [activeTab, setActiveTab] = useState('words');
    const [loading, setLoading] = useState(true);

    // Banned Words state
    const [words, setWords] = useState([]);
    const [wordsTotal, setWordsTotal] = useState(0);
    const [wordsPage, setWordsPage] = useState(1);
    const [wordsSearch, setWordsSearch] = useState('');
    const [wordsCategoryFilter, setWordsCategoryFilter] = useState('');
    const [wordsLanguageFilter, setWordsLanguageFilter] = useState('');

    // Flagged Messages state
    const [flagged, setFlagged] = useState([]);
    const [flaggedTotal, setFlaggedTotal] = useState(0);
    const [flaggedPage, setFlaggedPage] = useState(1);
    const [flaggedStatusFilter, setFlaggedStatusFilter] = useState('');

    // Stats
    const [stats, setStats] = useState(null);

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showReviewModal, setShowReviewModal] = useState(false);
    const [selectedWord, setSelectedWord] = useState(null);
    const [selectedFlagged, setSelectedFlagged] = useState(null);
    const [modalLoading, setModalLoading] = useState(false);

    // Add form
    const [newWord, setNewWord] = useState({ word: '', category: 'other', language: 'other' });

    // Bulk form
    const [bulkText, setBulkText] = useState('');
    const [bulkCategory, setBulkCategory] = useState('other');
    const [bulkLanguage, setBulkLanguage] = useState('other');

    // Edit form
    const [editForm, setEditForm] = useState({ word: '', category: 'other', language: 'other', isActive: true });

    // Review form
    const [reviewAction, setReviewAction] = useState('none');
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

    // Fetch banned words
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

    // Fetch flagged messages
    const fetchFlagged = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page: flaggedPage, limit: 20 });
            if (flaggedStatusFilter) params.append('status', flaggedStatusFilter);

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
    }, [flaggedPage, flaggedStatusFilter]);

    // Fetch stats
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

    // Add single word
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

    // Bulk import
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

    // Edit word
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

    // Delete word
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

    // Toggle word active
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

    // Seed default words
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

    // Review flagged message
    const handleReview = async (e) => {
        e.preventDefault();
        if (!selectedFlagged) return;
        setModalLoading(true);
        try {
            const res = await fetch(`${API_URL}/banned-words/flagged/${selectedFlagged._id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ action: reviewAction, notes: reviewNotes })
            });
            const data = await res.json();
            if (data.success) {
                setShowReviewModal(false);
                setSelectedFlagged(null);
                setReviewAction('none');
                setReviewNotes('');
                fetchFlagged();
                fetchStats();
            }
        } catch (err) {
            alert('خطأ في المراجعة');
        }
        setModalLoading(false);
    };

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
        setReviewAction('none');
        setReviewNotes('');
        setShowReviewModal(true);
    };

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

    return (
        <div className="banned-words-page">
            {/* Stats Cards */}
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

            {/* Tabs */}
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
            </div>

            {/* Words Tab */}
            {activeTab === 'words' && (
                <div className="bw-section">
                    {/* Actions Bar */}
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

                    {/* Words Table */}
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

            {/* Flagged Messages Tab */}
            {activeTab === 'flagged' && (
                <div className="bw-section">
                    <div className="bw-actions-bar">
                        <div className="bw-search-group">
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
                        </div>
                    </div>

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
                                <table className="bw-table">
                                    <thead>
                                        <tr>
                                            <th>المرسل</th>
                                            <th>المستقبل</th>
                                            <th>المحتوى الأصلي</th>
                                            <th>الكلمات المطابقة</th>
                                            <th>الحالة</th>
                                            <th>التاريخ</th>
                                            <th>إجراءات</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {flagged.map((item) => (
                                            <tr key={item._id}>
                                                <td>
                                                    <div className="bw-sender">
                                                        <span
                                                            className="sender-name clickable"
                                                            onClick={() => item.sender?._id && onViewUserDetail && onViewUserDetail(item.sender._id)}
                                                            title="عرض الملف الشخصي"
                                                        >
                                                            👤 {item.sender?.name || 'مجهول'}
                                                        </span>
                                                    </div>
                                                </td>
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
                                                <td className="content-cell">
                                                    <span className="flagged-content">{item.originalContent}</span>
                                                </td>
                                                <td>
                                                    <div className="matched-words">
                                                        {(item.matchedWords || []).map((w, i) => (
                                                            <span key={i} className="bw-badge danger">{w}</span>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td>
                                                    <span className={`bw-status ${getStatusClass(item.status)}`}>
                                                        {getStatusLabel(item.status)}
                                                    </span>
                                                </td>
                                                <td className="date-cell">
                                                    {new Date(item.createdAt).toLocaleDateString('ar-SA')}
                                                </td>
                                                <td>
                                                    <div className="bw-action-btns">
                                                        {item.conversation && (
                                                            <button
                                                                className="bw-btn secondary small"
                                                                onClick={() => onViewConversation && onViewConversation(item.conversation)}
                                                                title="عرض المحادثة"
                                                            >
                                                                💬 المحادثة
                                                            </button>
                                                        )}
                                                        {item.status === 'pending' ? (
                                                            <button
                                                                className="bw-btn primary small"
                                                                onClick={() => openReviewModal(item)}
                                                            >
                                                                📋 مراجعة
                                                            </button>
                                                        ) : (
                                                            <span className="bw-reviewed-label">
                                                                {item.action === 'none' ? 'تم التجاهل' :
                                                                 item.action === 'warning' ? 'تم التحذير' :
                                                                 item.action === 'message_deleted' ? 'تم حذف الرسالة' :
                                                                 item.action === 'user_suspended' ? 'تم الإيقاف' :
                                                                 item.action === 'user_banned' ? 'تم الحظر' : item.action}
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

            {/* Add Word Modal */}
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

            {/* Bulk Import Modal */}
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

            {/* Edit Word Modal */}
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

            {/* Delete Confirm */}
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

            {/* Review Modal */}
            {showReviewModal && selectedFlagged && (
                <div className="modal-overlay" onClick={() => setShowReviewModal(false)}>
                    <div className="bw-modal review-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="bw-modal-header">
                            <h3>مراجعة رسالة محظورة</h3>
                            <button className="bw-close-btn" onClick={() => setShowReviewModal(false)}>✕</button>
                        </div>
                        <div className="review-details">
                            <div className="review-info-row">
                                <span className="review-label">المرسل:</span>
                                <span className="review-value">{selectedFlagged.sender?.name || 'مجهول'}</span>
                            </div>
                            <div className="review-info-row">
                                <span className="review-label">المحتوى الأصلي:</span>
                                <span className="review-value flagged-text">{selectedFlagged.originalContent}</span>
                            </div>
                            <div className="review-info-row">
                                <span className="review-label">الكلمات المطابقة:</span>
                                <div className="matched-words">
                                    {(selectedFlagged.matchedWords || []).map((w, i) => (
                                        <span key={i} className="bw-badge danger">{w}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <form onSubmit={handleReview}>
                            <div className="bw-form-group">
                                <label>الإجراء</label>
                                <select value={reviewAction} onChange={(e) => setReviewAction(e.target.value)}>
                                    <option value="none">تجاهل (بدون إجراء)</option>
                                    <option value="warning">إرسال تحذير</option>
                                    <option value="message_deleted">حذف الرسالة</option>
                                    <option value="user_suspended">إيقاف المستخدم</option>
                                    <option value="user_banned">حظر المستخدم</option>
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
                            <div className="bw-modal-actions">
                                <button type="button" className="bw-btn cancel" onClick={() => setShowReviewModal(false)}>إلغاء</button>
                                <button type="submit" className="bw-btn primary" disabled={modalLoading}>
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

export default BannedWords;

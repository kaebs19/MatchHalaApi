import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { getSeverityBadge } from '../utils/badgeHelpers';
import api from '../services/api';
import './BannedWords.css';

function BannedWords() {
    const { showToast } = useToast();
    const [words, setWords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0 });
    const [filter, setFilter] = useState({ type: '', isActive: '' });
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [showTestModal, setShowTestModal] = useState(false);
    const [editingWord, setEditingWord] = useState(null);
    const [formData, setFormData] = useState({
        word: '',
        type: 'both',
        severity: 'medium',
        action: 'filter',
        isActive: true
    });
    const [bulkWords, setBulkWords] = useState('');
    const [testText, setTestText] = useState('');
    const [testResult, setTestResult] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, wordId: null });

    const fetchWords = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ page, limit: 20 });
            if (filter.type) params.append('type', filter.type);
            if (filter.isActive !== '') params.append('isActive', filter.isActive);

            const response = await api.get(`/banned-words?${params}`);
            if (response.data.success) {
                setWords(response.data.data.words);
                setTotalPages(response.data.data.pagination?.pages || 1);
            }
        } catch (error) {
            showToast('فشل في جلب الكلمات المحظورة', 'error');
        } finally {
            setLoading(false);
        }
    }, [page, filter, showToast]);

    const fetchStats = useCallback(async () => {
        try {
            const response = await api.get('/banned-words/stats');
            if (response.data.success) {
                setStats(response.data.data);
            }
        } catch (error) {
            console.error('فشل في جلب الإحصائيات');
        }
    }, []);

    useEffect(() => {
        fetchWords();
        fetchStats();
    }, [fetchWords, fetchStats]);

    const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.word.trim()) {
            showToast('الكلمة مطلوبة', 'error');
            return;
        }

        setSubmitting(true);
        try {
            if (editingWord) {
                const response = await api.put(`/banned-words/${editingWord._id}`, formData);
                if (response.data.success) {
                    showToast('تم تحديث الكلمة بنجاح', 'success');
                    setWords(prev => prev.map(w => w._id === editingWord._id ? response.data.data : w));
                }
            } else {
                const response = await api.post('/banned-words', formData);
                if (response.data.success) {
                    showToast('تم إضافة الكلمة بنجاح', 'success');
                    fetchWords();
                    fetchStats();
                }
            }
            closeModal();
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في حفظ الكلمة', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleBulkAdd = async (e) => {
        e.preventDefault();
        if (!bulkWords.trim()) {
            showToast('أدخل الكلمات', 'error');
            return;
        }

        const wordsArray = bulkWords.split('\n').filter(w => w.trim());
        if (wordsArray.length === 0) {
            showToast('لا توجد كلمات صالحة', 'error');
            return;
        }

        setSubmitting(true);
        try {
            const response = await api.post('/banned-words/bulk', {
                words: wordsArray,
                type: formData.type,
                severity: formData.severity,
                action: formData.action
            });
            if (response.data.success) {
                showToast(`تم إضافة ${response.data.data.added} كلمة بنجاح`, 'success');
                fetchWords();
                fetchStats();
                setShowBulkModal(false);
                setBulkWords('');
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في إضافة الكلمات', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleTestText = async (e) => {
        e.preventDefault();
        if (!testText.trim()) {
            showToast('أدخل النص للفحص', 'error');
            return;
        }

        setSubmitting(true);
        try {
            const response = await api.post('/banned-words/check', { text: testText });
            if (response.data.success) {
                setTestResult(response.data.data);
            }
        } catch (error) {
            showToast('فشل في فحص النص', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleActive = async (wordId) => {
        try {
            const response = await api.put(`/banned-words/${wordId}/toggle`);
            if (response.data.success) {
                setWords(prev => prev.map(w => w._id === wordId ? response.data.data : w));
                fetchStats();
                showToast('تم تحديث الحالة', 'success');
            }
        } catch (error) {
            showToast('فشل في تحديث الحالة', 'error');
        }
    };

    const handleDelete = async (wordId) => {
        try {
            const response = await api.delete(`/banned-words/${wordId}`);
            if (response.data.success) {
                setWords(prev => prev.filter(w => w._id !== wordId));
                fetchStats();
                showToast('تم حذف الكلمة', 'success');
            }
        } catch (error) {
            showToast('فشل في حذف الكلمة', 'error');
        } finally {
            setDeleteConfirm({ show: false, wordId: null });
        }
    };

    const openEditModal = (word) => {
        setEditingWord(word);
        setFormData({
            word: word.word,
            type: word.type,
            severity: word.severity,
            action: word.action,
            isActive: word.isActive
        });
        setShowAddModal(true);
    };

    const closeModal = () => {
        setShowAddModal(false);
        setEditingWord(null);
        setFormData({
            word: '',
            type: 'both',
            severity: 'medium',
            action: 'filter',
            isActive: true
        });
    };

    const severityLabels = { low: 'منخفضة', medium: 'متوسطة', high: 'عالية', critical: 'حرجة' };

    const getTypeBadge = (type) => {
        const types = {
            word: 'كلمة',
            name: 'اسم',
            both: 'الكل'
        };
        return types[type] || type;
    };

    const getActionBadge = (action) => {
        const actions = {
            filter: 'فلترة',
            warn: 'تحذير',
            block: 'حظر',
            ban: 'حظر دائم'
        };
        return actions[action] || action;
    };

    return (
        <div className="banned-words-page">
            {/* Header */}
            <div className="page-header">
                <div className="header-stats">
                    <div className="stat-box">
                        <span className="stat-number">{stats.total}</span>
                        <span className="stat-label">إجمالي الكلمات</span>
                    </div>
                    <div className="stat-box active">
                        <span className="stat-number">{stats.active}</span>
                        <span className="stat-label">نشطة</span>
                    </div>
                    <div className="stat-box inactive">
                        <span className="stat-number">{stats.inactive}</span>
                        <span className="stat-label">غير نشطة</span>
                    </div>
                </div>
                <div className="header-actions">
                    <button className="btn-test" onClick={() => setShowTestModal(true)}>
                        🔍 فحص نص
                    </button>
                    <button className="btn-bulk" onClick={() => setShowBulkModal(true)}>
                        📋 إضافة بالجملة
                    </button>
                    <button className="btn-add" onClick={() => setShowAddModal(true)}>
                        ➕ إضافة كلمة
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="filters-section">
                <select
                    value={filter.type}
                    onChange={(e) => { setFilter(f => ({ ...f, type: e.target.value })); setPage(1); }}
                >
                    <option value="">جميع الأنواع</option>
                    <option value="word">كلمات</option>
                    <option value="name">أسماء</option>
                    <option value="both">الكل</option>
                </select>
                <select
                    value={filter.isActive}
                    onChange={(e) => { setFilter(f => ({ ...f, isActive: e.target.value })); setPage(1); }}
                >
                    <option value="">جميع الحالات</option>
                    <option value="true">نشطة</option>
                    <option value="false">غير نشطة</option>
                </select>
            </div>

            {/* Words Table */}
            <div className="words-table-container">
                {loading ? (
                    <div className="loading-state">
                        <div className="loading-spinner"></div>
                        <p>جاري التحميل...</p>
                    </div>
                ) : words.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">🚫</span>
                        <h3>لا توجد كلمات محظورة</h3>
                        <p>ابدأ بإضافة كلمات لحماية التطبيق</p>
                    </div>
                ) : (
                    <table className="words-table">
                        <thead>
                            <tr>
                                <th>الكلمة</th>
                                <th>النوع</th>
                                <th>الخطورة</th>
                                <th>الإجراء</th>
                                <th>الحالة</th>
                                <th>الاستخدام</th>
                                <th>الإجراءات</th>
                            </tr>
                        </thead>
                        <tbody>
                            {words.map((word) => (
                                <tr key={word._id} className={!word.isActive ? 'inactive-row' : ''}>
                                    <td className="word-cell">
                                        <span className="word-text">{word.word}</span>
                                    </td>
                                    <td>
                                        <span className="type-badge">{getTypeBadge(word.type)}</span>
                                    </td>
                                    <td>
                                        {getSeverityBadge(word.severity)}
                                    </td>
                                    <td>
                                        <span className="action-badge">{getActionBadge(word.action)}</span>
                                    </td>
                                    <td>
                                        <button
                                            className={`status-toggle ${word.isActive ? 'active' : 'inactive'}`}
                                            onClick={() => handleToggleActive(word._id)}
                                        >
                                            {word.isActive ? '✓ نشط' : '✗ معطل'}
                                        </button>
                                    </td>
                                    <td className="usage-cell">
                                        <span className="usage-count">{word.usageCount || 0}</span>
                                    </td>
                                    <td className="actions-cell">
                                        <button className="edit-btn" onClick={() => openEditModal(word)} title="تعديل">
                                            ✏️
                                        </button>
                                        <button className="delete-btn" onClick={() => setDeleteConfirm({ show: true, wordId: word._id })} title="حذف">
                                            🗑️
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="pagination">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                        السابق
                    </button>
                    <span>صفحة {page} من {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                        التالي
                    </button>
                </div>
            )}

            {/* Add/Edit Modal */}
            {showAddModal && (
                <div className="modal-overlay" onClick={closeModal}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingWord ? '✏️ تعديل كلمة' : '➕ إضافة كلمة جديدة'}</h3>
                            <button className="close-btn" onClick={closeModal}>×</button>
                        </div>
                        <form onSubmit={handleSubmit}>
                            <div className="form-group">
                                <label>الكلمة *</label>
                                <input
                                    type="text"
                                    name="word"
                                    value={formData.word}
                                    onChange={handleInputChange}
                                    placeholder="أدخل الكلمة المحظورة"
                                    required
                                    disabled={editingWord}
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>النوع</label>
                                    <select name="type" value={formData.type} onChange={handleInputChange}>
                                        <option value="word">كلمة</option>
                                        <option value="name">اسم</option>
                                        <option value="both">الكل</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>الخطورة</label>
                                    <select name="severity" value={formData.severity} onChange={handleInputChange}>
                                        <option value="low">منخفضة</option>
                                        <option value="medium">متوسطة</option>
                                        <option value="high">عالية</option>
                                        <option value="critical">حرجة</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>الإجراء</label>
                                    <select name="action" value={formData.action} onChange={handleInputChange}>
                                        <option value="filter">فلترة (استبدال)</option>
                                        <option value="warn">تحذير المستخدم</option>
                                        <option value="block">حظر الرسالة</option>
                                        <option value="ban">حظر المستخدم</option>
                                    </select>
                                </div>
                                <div className="form-group checkbox-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            name="isActive"
                                            checked={formData.isActive}
                                            onChange={handleInputChange}
                                        />
                                        نشطة
                                    </label>
                                </div>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="cancel-btn" onClick={closeModal}>إلغاء</button>
                                <button type="submit" className="submit-btn" disabled={submitting}>
                                    {submitting ? 'جاري الحفظ...' : (editingWord ? 'تحديث' : 'إضافة')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Bulk Add Modal */}
            {showBulkModal && (
                <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📋 إضافة كلمات بالجملة</h3>
                            <button className="close-btn" onClick={() => setShowBulkModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleBulkAdd}>
                            <div className="form-group">
                                <label>الكلمات (كل كلمة في سطر)</label>
                                <textarea
                                    value={bulkWords}
                                    onChange={(e) => setBulkWords(e.target.value)}
                                    placeholder="كلمة 1&#10;كلمة 2&#10;كلمة 3"
                                    rows={8}
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>النوع</label>
                                    <select name="type" value={formData.type} onChange={handleInputChange}>
                                        <option value="word">كلمة</option>
                                        <option value="name">اسم</option>
                                        <option value="both">الكل</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>الخطورة</label>
                                    <select name="severity" value={formData.severity} onChange={handleInputChange}>
                                        <option value="low">منخفضة</option>
                                        <option value="medium">متوسطة</option>
                                        <option value="high">عالية</option>
                                    </select>
                                </div>
                            </div>
                            <div className="modal-actions">
                                <button type="button" className="cancel-btn" onClick={() => setShowBulkModal(false)}>إلغاء</button>
                                <button type="submit" className="submit-btn" disabled={submitting}>
                                    {submitting ? 'جاري الإضافة...' : 'إضافة الكلمات'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Delete Confirmation */}
            <ConfirmModal
                isOpen={deleteConfirm.show}
                onClose={() => setDeleteConfirm({ show: false, wordId: null })}
                onConfirm={() => handleDelete(deleteConfirm.wordId)}
                title="🗑️ حذف كلمة"
                message="هل أنت متأكد من حذف هذه الكلمة؟"
                confirmText="حذف"
                cancelText="إلغاء"
                variant="danger"
            />

            {/* Test Text Modal */}
            {showTestModal && (
                <div className="modal-overlay" onClick={() => { setShowTestModal(false); setTestResult(null); }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🔍 فحص نص</h3>
                            <button className="close-btn" onClick={() => { setShowTestModal(false); setTestResult(null); }}>×</button>
                        </div>
                        <form onSubmit={handleTestText}>
                            <div className="form-group">
                                <label>أدخل النص للفحص</label>
                                <textarea
                                    value={testText}
                                    onChange={(e) => setTestText(e.target.value)}
                                    placeholder="أدخل النص هنا للتحقق من وجود كلمات محظورة..."
                                    rows={4}
                                />
                            </div>
                            <button type="submit" className="submit-btn full-width" disabled={submitting}>
                                {submitting ? 'جاري الفحص...' : 'فحص النص'}
                            </button>
                        </form>

                        {testResult && (
                            <div className={`test-result ${testResult.isClean ? 'clean' : 'dirty'}`}>
                                <h4>{testResult.isClean ? '✅ النص نظيف' : '⚠️ تم العثور على كلمات محظورة'}</h4>
                                {!testResult.isClean && (
                                    <>
                                        <p><strong>الكلمات الموجودة:</strong> {testResult.foundWords?.join('، ')}</p>
                                        <p><strong>أعلى خطورة:</strong> {severityLabels[testResult.highestSeverity] || testResult.highestSeverity}</p>
                                        <p><strong>الإجراء المقترح:</strong> {getActionBadge(testResult.suggestedAction)}</p>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default BannedWords;

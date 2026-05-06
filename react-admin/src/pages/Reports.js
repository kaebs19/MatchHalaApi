import React, { useState, useEffect } from 'react';
import { getAllReports, getReportsStats, updateReportStatus, takeReportAction, updateReportPriority, deleteReport, bulkUpdateReportStatus, bulkDeleteReports, resolveAllPendingReports, getTopReported, getTopReporters } from '../services/api';
import { useToast } from '../components/Toast';
import Pagination from '../components/Pagination';
import LoadingSpinner from '../components/LoadingSpinner';
import { getImageUrl } from '../config';
import { formatDateTime } from '../utils/formatters';
import ConfirmModal from '../components/ConfirmModal';
import './Reports.css';

function Reports({ onViewUserDetail, onViewConversation }) {

    const highlightBannedWords = (content, bannedWordsFound) => {
        if (!content || !bannedWordsFound || bannedWordsFound.length === 0) return content;
        const words = bannedWordsFound.map(w => w.word);
        const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        const regex = new RegExp(`(${pattern})`, 'gi');
        const parts = content.split(regex);
        return parts.map((part, i) => {
            const match = bannedWordsFound.find(w => w.word.toLowerCase() === part.toLowerCase());
            if (match) {
                return <mark key={i} className={`highlighted-banned-word ${match.severity}`}>{part}</mark>;
            }
            return part;
        });
    };
    const [reports, setReports] = useState([]);
    const [stats, setStats] = useState({
        totalReports: 0,
        pendingReports: 0,
        reviewingReports: 0,
        resolvedReports: 0,
        urgentReports: 0
    });
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterPriority, setFilterPriority] = useState('all');
    const [filterType, setFilterType] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [selectedReport, setSelectedReport] = useState(null);
    const [showActionModal, setShowActionModal] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState({ show: false, reportId: null });
    const { showToast } = useToast();

    const [selectedReportIds, setSelectedReportIds] = useState(new Set());
    const [selectAll, setSelectAll] = useState(false);
    const [topReported, setTopReported] = useState([]);
    const [topReporters, setTopReporters] = useState([]);
    const [showTopReported, setShowTopReported] = useState(false);
    const [filterCategory, setFilterCategory] = useState('all');
    const [bulkLoading, setBulkLoading] = useState(false);

    useEffect(() => {
        fetchReports();
        fetchStats();
    }, [currentPage, filterStatus, filterPriority, filterType, filterCategory]);

    const fetchReports = async () => {
        try {
            setLoading(true);
            const filters = {};
            if (filterStatus !== 'all') filters.status = filterStatus;
            if (filterPriority !== 'all') filters.priority = filterPriority;
            if (filterType !== 'all') filters.type = filterType;
            if (filterCategory !== 'all') filters.category = filterCategory;

            const response = await getAllReports(currentPage, 20, filters);
            if (response.success) {
                setReports(response.data.reports);
                setTotalPages(response.data.totalPages);
            }
        } catch (error) {
            showToast('فشل في تحميل البلاغات', 'error');
            console.error('Error fetching reports:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchStats = async () => {
        try {
            const response = await getReportsStats();
            if (response.success) {
                setStats(response.data);
            }
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    const handleStatusChange = async (reportId, newStatus) => {
        try {
            const response = await updateReportStatus(reportId, newStatus);
            if (response.success) {
                showToast('تم تحديث حالة البلاغ', 'success');
                fetchReports();
                fetchStats();
            }
        } catch (error) {
            showToast('فشل في تحديث الحالة', 'error');
        }
    };

    const handlePriorityChange = async (reportId, newPriority) => {
        try {
            const response = await updateReportPriority(reportId, newPriority);
            if (response.success) {
                showToast('تم تحديث الأولوية', 'success');
                fetchReports();
            }
        } catch (error) {
            showToast('فشل في تحديث الأولوية', 'error');
        }
    };

    const handleTakeAction = async (action) => {
        if (!selectedReport) return;

        try {
            const response = await takeReportAction(selectedReport._id, action);
            if (response.success) {
                showToast('تم تنفيذ الإجراء بنجاح', 'success');
                setShowActionModal(false);
                setSelectedReport(null);
                fetchReports();
                fetchStats();
            }
        } catch (error) {
            showToast('فشل في تنفيذ الإجراء', 'error');
        }
    };


    const handleDelete = async () => {
        if (!deleteConfirm.reportId) return;
        try {
            const response = await deleteReport(deleteConfirm.reportId);
            if (response.success) {
                showToast('Done', 'success');
                fetchReports();
                fetchStats();
            }
        } catch (error) {
            showToast('Failed', 'error');
        } finally {
            setDeleteConfirm({ show: false, reportId: null });
        }
    };

    const handleTakeAction_quick = async (reportId, action) => {
        try {
            const response = await takeReportAction(reportId, action);
            if (response.success) {
                showToast(Done, success);
                fetchReports();
                fetchStats();
            }
        } catch (error) {
            showToast(Failed, error);
        }
    };

    const handleBulkResolve = async () => {
        if (selectedReportIds.size === 0) return;
        const choice = window.prompt('اختر الإجراء: 1=تجاهل 2=رفض (' + selectedReportIds.size + ' بلاغ)');
        if (!choice) return;
        const status = choice.trim() === '2' ? 'rejected' : 'resolved';
        try {
            setBulkLoading(true);
            await bulkUpdateReportStatus([...selectedReportIds], status);
            showToast(`تم ${status === 'rejected' ? 'رفض' : 'معالجة'} ${selectedReportIds.size} بلاغ`, 'success');
            setSelectedReportIds(new Set());
            setSelectAll(false);
            setFilterStatus('pending');
            fetchReports(); fetchStats();
        } catch { showToast('فشل', 'error'); }
        finally { setBulkLoading(false); }
    };

    const handleBulkDelete = async () => {
        if (selectedReportIds.size === 0) return;
        if (!window.confirm(`حذف ${selectedReportIds.size} بلاغ؟`)) return;
        try {
            setBulkLoading(true);
            await bulkDeleteReports([...selectedReportIds]);
            showToast(`تم حذف ${selectedReportIds.size} بلاغ`, 'success');
            setSelectedReportIds(new Set()); setSelectAll(false);
            fetchReports(); fetchStats();
        } catch { showToast('فشل', 'error'); }
        finally { setBulkLoading(false); }
    };

    const handleResolveAll = async () => {
        if (!window.confirm('معالجة جميع البلاغات المعلقة؟')) return;
        try {
            setBulkLoading(true);
            const res = await resolveAllPendingReports();
            showToast(`تم معالجة ${res.data?.count || 0} بلاغ`, 'success');
            fetchReports(); fetchStats();
        } catch { showToast('فشل', 'error'); }
        finally { setBulkLoading(false); }
    };

    const toggleSelectReport = (id) => {
        setSelectedReportIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedReportIds(new Set());
        } else {
            setSelectedReportIds(new Set(reports.map(r => r._id)));
        }
        setSelectAll(!selectAll);
    };

    const fetchTopReported = async () => {
        try {
            const res = await getTopReported();
            if (res.success) setTopReported(res.data);
        } catch {}
    };

    const fetchTopReporters = async () => {
        try {
            const res = await getTopReporters();
            if (res.success) setTopReporters(res.data);
        } catch {}
    };

    const getCategoryLabel = (category) => {
        const categories = {
            spam: 'رسائل مزعجة',
            harassment: 'تحرش',
            inappropriate_content: 'محتوى غير لائق',
            hate_speech: 'خطاب كراهية',
            violence: 'عنف',
            fraud: 'احتيال',
            impersonation: 'انتحال شخصية',
            other: 'أخرى'
        };
        return categories[category] || category;
    };

    const getTypeLabel = (type) => {
        const types = {
            user: 'مستخدم',
            message: 'رسالة',
            conversation: 'محادثة'
        };
        return types[type] || type;
    };

    return (
        <div className="reports-page">
            {/* Statistics */}
            <div className="reports-stats">
                <div className="stat-box total">
                    <div className="stat-icon">📊</div>
                    <div className="stat-info">
                        <h3>{stats.totalReports}</h3>
                        <p>إجمالي البلاغات</p>
                    </div>
                </div>
                <div className="stat-box pending">
                    <div className="stat-icon">⏳</div>
                    <div className="stat-info">
                        <h3>{stats.pendingReports}</h3>
                        <p>قيد الانتظار</p>
                    </div>
                </div>
                <div className="stat-box reviewing">
                    <div className="stat-icon">👀</div>
                    <div className="stat-info">
                        <h3>{stats.reviewingReports}</h3>
                        <p>قيد المراجعة</p>
                    </div>
                </div>
                <div className="stat-box resolved">
                    <div className="stat-icon">✅</div>
                    <div className="stat-info">
                        <h3>{stats.resolvedReports}</h3>
                        <p>تم الحل</p>
                    </div>
                </div>
                <div className="stat-box urgent">
                    <div className="stat-icon">🚨</div>
                    <div className="stat-info">
                        <h3>{stats.urgentReports}</h3>
                        <p>عاجلة</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="reports-filters">
                <select
                    value={filterStatus}
                    onChange={(e) => {
                        setFilterStatus(e.target.value);
                        setCurrentPage(1);
                    }}
                >
                    <option value="all">جميع الحالات</option>
                    <option value="pending">قيد الانتظار</option>
                    <option value="reviewing">قيد المراجعة</option>
                    <option value="resolved">تم الحل</option>
                    <option value="rejected">مرفوض</option>
                </select>

                <select
                    value={filterPriority}
                    onChange={(e) => {
                        setFilterPriority(e.target.value);
                        setCurrentPage(1);
                    }}
                >
                    <option value="all">جميع الأولويات</option>
                    <option value="urgent">عاجل</option>
                    <option value="high">عالي</option>
                    <option value="medium">متوسط</option>
                    <option value="low">منخفض</option>
                </select>

                <select
                    value={filterType}
                    onChange={(e) => {
                        setFilterType(e.target.value);
                        setCurrentPage(1);
                    }}
                >
                    <option value="all">جميع الأنواع</option>
                    <option value="user">مستخدم</option>
                    <option value="message">رسالة</option>
                    <option value="conversation">محادثة</option>
                </select>

                <select
                    value={filterCategory}
                    onChange={(e) => {
                        setFilterCategory(e.target.value);
                        setCurrentPage(1);
                    }}
                >
                    <option value="all">جميع الفئات</option>
                    <option value="harassment">تحرش</option>
                    <option value="inappropriate_content">محتوى غير لائق</option>
                    <option value="spam">رسائل مزعجة</option>
                    <option value="fake_profile">حساب مزيف</option>
                    <option value="hate_speech">خطاب كراهية</option>
                    <option value="violence">عنف</option>
                    <option value="fraud">احتيال</option>
                    <option value="other">أخرى</option>
                </select>

                <button onClick={fetchReports} className="refresh-btn">
                    تحديث 🔄
                </button>
            </div>

            {/* Bulk Actions Bar */}
            <div className="bulk-actions-bar">
                <label className="select-all-label">
                    <input type="checkbox" checked={selectAll} onChange={handleSelectAll} />
                    تحديد الكل
                </label>
                {selectedReportIds.size > 0 && (
                    <span className="selected-count">({selectedReportIds.size} محدد)</span>
                )}
                <button onClick={handleBulkResolve} disabled={selectedReportIds.size === 0 || bulkLoading} className="bulk-btn resolve">✅ معالجة المحدد</button>
                <button onClick={handleBulkDelete} disabled={selectedReportIds.size === 0 || bulkLoading} className="bulk-btn delete">🗑️ حذف المحدد</button>
                <div style={{flex:1}}></div>
                <button onClick={handleResolveAll} disabled={bulkLoading} className="bulk-btn resolve-all">✅ معالجة الكل المعلق</button>
                <button onClick={() => { fetchTopReported(); fetchTopReporters(); setShowTopReported(true); }} className="bulk-btn analytics">📊 الأكثر إبلاغاً</button>
            </div>

            {/* Reports List */}
            {loading ? (
                <LoadingSpinner text="جاري تحميل البلاغات..." />
            ) : reports.length === 0 ? (
                <div className="no-reports">
                    <p>لا توجد بلاغات 📭</p>
                </div>
            ) : (
                <>
                    <div className="reports-list">
                        {reports.map((report) => (
                            <div key={report._id} className={`report-card priority-${report.priority} ${selectedReportIds.has(report._id) ? 'selected' : ''}`}>
                                <div className="report-select">
                                    <input type="checkbox" checked={selectedReportIds.has(report._id)} onChange={() => toggleSelectReport(report._id)} />
                                </div>
                                <div className="report-header">
                                    <div className="report-meta">
                                        <span className={`report-type ${report.type}`}>
                                            {getTypeLabel(report.type)}
                                        </span>
                                        <span className={`report-category`}>
                                            {getCategoryLabel(report.category)}
                                        </span>
                                        <span className={`report-priority ${report.priority}`}>
                                            {report.priority === 'urgent' && '🚨'}
                                            {report.priority === 'high' && '🔴'}
                                            {report.priority === 'medium' && '🟡'}
                                            {report.priority === 'low' && '🟢'}
                                            {report.priority}
                                        </span>
                                    </div>
                                    <span className="report-date">{formatDateTime(report.createdAt)}</span>
                                </div>

                                <div className="report-body">
                                    <p className="report-description">{report.description}</p>

                                    <div className="report-users">
                                        <div className="report-user">
                                            <span className="label">المبلّغ:</span>
                                            {report.reportedBy?._id && onViewUserDetail ? (
                                                <span className="value user-link" onClick={() => onViewUserDetail(report.reportedBy._id)}>
                                                    {report.reportedBy?.name || 'غير معروف'}
                                                </span>
                                            ) : (
                                                <span className="value">{report.reportedBy?.name || 'غير معروف'}</span>
                                            )}
                                        </div>
                                        {report.reportedUser && (
                                            <div className="report-user">
                                                <span className="label">المبلّغ عليه:</span>
                                                {report.reportedUser?._id && onViewUserDetail ? (
                                                    <span className="value user-link" onClick={() => onViewUserDetail(report.reportedUser._id)}>
                                                        {report.reportedUser?.name}
                                                    </span>
                                                ) : (
                                                    <span className="value">{report.reportedUser?.name}</span>
                                                )}
                                                {report.reportedUser?.totalReports > 0 && (
                                                    <span className="user-reports-count">{report.reportedUser.totalReports} بلاغ سابق</span>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* المحتوى المُبلغ عنه */}
                                    {(report.reportedMessage || report.reportedConversation) && (
                                        <div className="reported-content-section">
                                            <h4 className="reported-content-title">📋 المحتوى المُبلغ عنه</h4>

                                            {report.reportedMessage && (
                                                <div className="reported-message-box">
                                                    <div className="reported-message-header">
                                                        <span className="reported-sender">
                                                            ✉️ {report.reportedMessage.sender?.name || 'مجهول'}
                                                        </span>
                                                        <span className={`reported-type ${report.reportedMessage.type}`}>
                                                            {report.reportedMessage.type === 'text' && '📝 نص'}
                                                            {report.reportedMessage.type === 'image' && '🖼️ صورة'}
                                                            {report.reportedMessage.type === 'file' && '📎 ملف'}
                                                            {report.reportedMessage.type === 'audio' && '🎵 صوت'}
                                                            {report.reportedMessage.type === 'video' && '🎥 فيديو'}
                                                        </span>
                                                    </div>
                                                    {report.reportedMessage.content && (
                                                        <p className="reported-message-content">
                                                            {report.reportedMessage.hasBannedWords
                                                                ? highlightBannedWords(report.reportedMessage.content, report.reportedMessage.bannedWordsFound)
                                                                : report.reportedMessage.content
                                                            }
                                                        </p>
                                                    )}
                                                    {report.reportedMessage.type === 'image' && report.reportedMessage.mediaUrl && (
                                                        <img
                                                            src={getImageUrl(report.reportedMessage.mediaUrl)}
                                                            alt="صورة مبلغ عنها"
                                                            className="reported-message-image"
                                                            onError={(e) => { e.target.style.display = 'none'; }}
                                                        />
                                                    )}
                                                    {report.reportedMessage.hasBannedWords && report.reportedMessage.bannedWordsFound?.length > 0 && (
                                                        <div className="banned-words-badges">
                                                            <span className="banned-label">🚫 كلمات محظورة:</span>
                                                            {report.reportedMessage.bannedWordsFound.map((w, i) => (
                                                                <span key={i} className={`banned-word-badge severity-${w.severity}`}>{w.word}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {report.reportedConversation && (
                                                <div className="reported-conversation-box">
                                                    <div className="reported-conv-info">
                                                        <span>💬 المحادثة: {report.reportedConversation.title}</span>
                                                        <span className="conv-type-badge">
                                                            {report.reportedConversation.type === 'private' ? 'خاصة' : 'جماعية'}
                                                        </span>
                                                    </div>
                                                    {onViewConversation && report.reportedConversation._id && (
                                                        <button
                                                            className="view-conv-btn"
                                                            onClick={() => onViewConversation(report.reportedConversation._id)}
                                                        >
                                                            عرض المحادثة
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ✅ Phase 3: لقطة شاشة من المُبلِّغ — عرض inline */}
                                    {report.screenshot && (
                                        <div className="report-screenshot-inline">
                                            <span className="screenshot-label">📸 لقطة دليل من المُبلِّغ:</span>
                                            <a
                                                href={getImageUrl(report.screenshot)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="اضغط للتكبير"
                                            >
                                                <img
                                                    src={getImageUrl(report.screenshot)}
                                                    alt="screenshot"
                                                    className="report-screenshot-thumb"
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            </a>
                                        </div>
                                    )}
                                </div>

                                <div className="report-footer">
                                    <div className="quick-actions">
                                        <button title="تجاهل" className="quick-btn ignore" onClick={() => handleTakeAction_quick(report._id, 'none')}>✅</button>
                                        <button title="تحذير" className="quick-btn warn" onClick={() => handleTakeAction_quick(report._id, 'warning')}>⚠️</button>
                                        <button title="حذف الرسالة" className="quick-btn del-msg" onClick={() => handleTakeAction_quick(report._id, 'message_deleted')}>🗑️</button>

                                        {/* ✅ إجراءات سريعة جديدة */}
                                        {report.screenshot && (
                                            <button
                                                title="عرض لقطة الدليل"
                                                className="quick-btn view-screenshot"
                                                onClick={() => window.open(getImageUrl(report.screenshot), '_blank')}
                                            >📸</button>
                                        )}
                                        {report.reportedConversation?._id && onViewConversation && (
                                            <button
                                                title="عرض الدردشة"
                                                className="quick-btn view-chat"
                                                onClick={() => onViewConversation(report.reportedConversation._id)}
                                            >💬</button>
                                        )}
                                        {report.reportedUser?._id && (
                                            <button
                                                title="حظر فوري"
                                                className="quick-btn ban-now"
                                                onClick={() => {
                                                    if (window.confirm(`حظر ${report.reportedUser.name} نهائياً؟`)) {
                                                        handleTakeAction_quick(report._id, 'user_banned');
                                                    }
                                                }}
                                            >🚫</button>
                                        )}
                                    </div>
                                    <div className="report-status">
                                        <select
                                            value={report.status}
                                            onChange={(e) => handleStatusChange(report._id, e.target.value)}
                                            className={`status-select ${report.status}`}
                                        >
                                            <option value="pending">قيد الانتظار</option>
                                            <option value="reviewing">قيد المراجعة</option>
                                            <option value="resolved">تم الحل</option>
                                            <option value="rejected">مرفوض</option>
                                        </select>

                                        <select
                                            value={report.priority}
                                            onChange={(e) => handlePriorityChange(report._id, e.target.value)}
                                            className={`priority-select ${report.priority}`}
                                        >
                                            <option value="urgent">عاجل</option>
                                            <option value="high">عالي</option>
                                            <option value="medium">متوسط</option>
                                            <option value="low">منخفض</option>
                                        </select>
                                    </div>

                                    <div className="report-actions">
                                        <button
                                            onClick={() => {
                                                setSelectedReport(report);
                                                setShowActionModal(true);
                                            }}
                                            className="action-btn"
                                        >
                                            اتخاذ إجراء
                                        </button>
                                        <button
                                            onClick={() => setDeleteConfirm({ show: true, reportId: report._id })}
                                            className="delete-btn"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                        itemsPerPage={20}
                        totalItems={stats.totalReports}
                    />
                </>
            )}

            {/* Delete Confirm Modal */}
            <ConfirmModal
                isOpen={deleteConfirm.show}
                onClose={() => setDeleteConfirm({ show: false, reportId: null })}
                onConfirm={handleDelete}
                title="تأكيد الحذف"
                message="هل أنت متأكد من حذف هذا البلاغ؟"
                confirmText="حذف"
                cancelText="إلغاء"
                variant="danger"
            />

            {/* Top Reported Modal */}
            {showTopReported && (
                <div className="modal-overlay" onClick={() => setShowTopReported(false)}>
                    <div className="modal-content top-reported-modal" onClick={e => e.stopPropagation()}>
                        <h3>📊 إحصائيات البلاغات</h3>
                        <div className="top-reported-sections">
                            <div className="top-section">
                                <h4>🚨 الأكثر تعرضاً للبلاغات</h4>
                                <div className="top-list">
                                    {topReported.map((u, i) => (
                                        <div key={u._id} className="top-item">
                                            <span className="top-rank">#{i+1}</span>
                                            <span className="top-name user-link" onClick={() => { setShowTopReported(false); onViewUserDetail && onViewUserDetail(u._id); }}>{u.name}</span>
                                            <span className="top-email">{u.email}</span>
                                            <span className="top-count">{u.count} بلاغ</span>
                                        </div>
                                    ))}
                                    {topReported.length === 0 && <p>لا توجد بيانات</p>}
                                </div>
                            </div>
                            <div className="top-section">
                                <h4>📢 الأكثر إبلاغاً (المُبلّغين)</h4>
                                <div className="top-list">
                                    {topReporters.map((u, i) => (
                                        <div key={u._id} className="top-item">
                                            <span className="top-rank">#{i+1}</span>
                                            <span className="top-name user-link" onClick={() => { setShowTopReported(false); onViewUserDetail && onViewUserDetail(u._id); }}>{u.name}</span>
                                            <span className="top-email">{u.email}</span>
                                            <span className="top-count">{u.count} بلاغ</span>
                                        </div>
                                    ))}
                                    {topReporters.length === 0 && <p>لا توجد بيانات</p>}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setShowTopReported(false)} className="modal-close-btn">إغلاق</button>
                    </div>
                </div>
            )}

            {/* Action Modal - Enhanced */}
            {showActionModal && selectedReport && (
                <div className="modal-overlay" onClick={() => setShowActionModal(false)}>
                    <div className="modal-content action-modal-enhanced" onClick={(e) => e.stopPropagation()}>
                        <div className="action-modal-header">
                            <h3>⚙️ اتخاذ إجراء</h3>
                            <button onClick={() => setShowActionModal(false)} className="modal-x-btn">✕</button>
                        </div>

                        {/* Report Context Card */}
                        <div className="action-context-card">
                            <div className="context-row">
                                <span className="context-label">📋 الفئة:</span>
                                <span className={"context-badge cat-" + selectedReport.category}>{getCategoryLabel(selectedReport.category)}</span>
                            </div>
                            <div className="context-row">
                                <span className="context-label">📢 المبلّغ:</span>
                                <span className="context-user-link" onClick={() => { setShowActionModal(false); onViewUserDetail && onViewUserDetail(selectedReport.reportedBy?._id); }}>
                                    {selectedReport.reportedBy?.name || 'غير معروف'}
                                </span>
                            </div>
                            {selectedReport.reportedUser && (
                                <div className="context-row">
                                    <span className="context-label">👤 المبلّغ عليه:</span>
                                    <span className="context-user-link" onClick={() => { setShowActionModal(false); onViewUserDetail && onViewUserDetail(selectedReport.reportedUser?._id); }}>
                                        {selectedReport.reportedUser?.name}
                                    </span>
                                    <span className="context-email">{selectedReport.reportedUser?.email}</span>
                                </div>
                            )}
                            {selectedReport.description && (
                                <div className="context-row">
                                    <span className="context-label">📝 الوصف:</span>
                                    <span className="context-desc">{selectedReport.description}</span>
                                </div>
                            )}
                            {selectedReport.reportedMessage?.content && (
                                <div className="context-message-box">
                                    <span className="context-msg-label">✉️ الرسالة المُبلغ عنها:</span>
                                    <p className="context-msg-text">{selectedReport.reportedMessage.content}</p>
                                </div>
                            )}
                            {selectedReport.reportedMessage?.type === 'image' && selectedReport.reportedMessage?.mediaUrl && (
                                <img src={getImageUrl(selectedReport.reportedMessage.mediaUrl)} alt="" className="context-msg-image" onError={(e) => { e.target.style.display = 'none'; }} />
                            )}

                            {/* ✅ Phase 3: لقطة شاشة من المُبلِّغ */}
                            {selectedReport.screenshot && (
                                <div className="context-screenshot-box">
                                    <span className="context-msg-label">📸 لقطة شاشة من المُبلِّغ:</span>
                                    <a
                                        href={getImageUrl(selectedReport.screenshot)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="context-screenshot-link"
                                    >
                                        <img
                                            src={getImageUrl(selectedReport.screenshot)}
                                            alt="Report screenshot"
                                            className="context-screenshot-image"
                                            onError={(e) => { e.target.style.display = 'none'; }}
                                        />
                                        <span className="screenshot-zoom-hint">🔍 اضغط للتكبير</span>
                                    </a>
                                </div>
                            )}
                        </div>

                        {/* Action Grid */}
                        <div className="action-grid">
                            <div className="action-card light" onClick={() => handleTakeAction('none')}>
                                <span className="action-card-icon">✅</span>
                                <span className="action-card-title">تجاهل</span>
                                <span className="action-card-desc">معالجة بدون إجراء</span>
                            </div>
                            <div className="action-card yellow" onClick={() => handleTakeAction('warning')}>
                                <span className="action-card-icon">⚠️</span>
                                <span className="action-card-title">تحذير</span>
                                <span className="action-card-desc">تصعيد مستوى واحد</span>
                            </div>
                            <div className="action-card blue" onClick={() => handleTakeAction('message_deleted')}>
                                <span className="action-card-icon">🗑️</span>
                                <span className="action-card-title">حذف الرسالة</span>
                                <span className="action-card-desc">حذف + إشعار المستخدم</span>
                            </div>
                            <div className="action-card orange" onClick={() => handleTakeAction('user_suspended')}>
                                <span className="action-card-icon">🔒</span>
                                <span className="action-card-title">تعليق</span>
                                <span className="action-card-desc">تصعيد تلقائي للمستوى التالي</span>
                            </div>
                            <div className="action-card red" onClick={() => { if(window.confirm('هل أنت متأكد من حظر المستخدم نهائياً؟')) handleTakeAction('user_banned'); }}>
                                <span className="action-card-icon">🚫</span>
                                <span className="action-card-title">حظر نهائي</span>
                                <span className="action-card-desc">حظر الحساب + الجهاز</span>
                            </div>
                            <div className="action-card purple" onClick={() => handleTakeAction('conversation_locked')}>
                                <span className="action-card-icon">🔐</span>
                                <span className="action-card-title">قفل المحادثة</span>
                                <span className="action-card-desc">منع الإرسال في المحادثة</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Reports;

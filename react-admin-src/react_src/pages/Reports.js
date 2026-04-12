import React, { useState, useEffect } from 'react';
import { getAllReports, getReportsStats, updateReportStatus, takeReportAction, updateReportPriority, deleteReport } from '../services/api';
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

    useEffect(() => {
        fetchReports();
        fetchStats();
    }, [currentPage, filterStatus, filterPriority, filterType]);

    const fetchReports = async () => {
        try {
            setLoading(true);
            const filters = {};
            if (filterStatus !== 'all') filters.status = filterStatus;
            if (filterPriority !== 'all') filters.priority = filterPriority;
            if (filterType !== 'all') filters.type = filterType;

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
                showToast('تم حذف البلاغ', 'success');
                fetchReports();
                fetchStats();
            }
        } catch (error) {
            showToast('فشل في حذف البلاغ', 'error');
        } finally {
            setDeleteConfirm({ show: false, reportId: null });
        }
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

                <button onClick={fetchReports} className="refresh-btn">
                    تحديث 🔄
                </button>
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
                            <div key={report._id} className={`report-card priority-${report.priority}`}>
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
                                </div>

                                <div className="report-footer">
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

            {/* Action Modal */}
            {showActionModal && selectedReport && (
                <div className="modal-overlay" onClick={() => setShowActionModal(false)}>
                    <div className="modal-content action-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>اتخاذ إجراء على البلاغ</h3>
                        <div className="modal-report-context">
                            <p className="modal-description">
                                البلاغ: {getCategoryLabel(selectedReport.category)}
                            </p>
                            {selectedReport.reportedUser && (
                                <p className="modal-reported-user">
                                    المبلّغ عليه: <strong>{selectedReport.reportedUser.name}</strong>
                                </p>
                            )}
                            {selectedReport.reportedMessage?.content && (
                                <div className="modal-message-preview">
                                    <span className="preview-label">الرسالة المُبلغ عنها:</span>
                                    <p className="preview-content">{selectedReport.reportedMessage.content}</p>
                                </div>
                            )}
                            {selectedReport.reportedMessage?.type === 'image' && selectedReport.reportedMessage?.mediaUrl && (
                                <img
                                    src={getImageUrl(selectedReport.reportedMessage.mediaUrl)}
                                    alt="صورة مبلغ عنها"
                                    className="modal-message-image"
                                    onError={(e) => { e.target.style.display = 'none'; }}
                                />
                            )}
                        </div>

                        <div className="action-buttons">
                            <button
                                onClick={() => handleTakeAction('warning')}
                                className="action-option warning"
                            >
                                ⚠️ إرسال تحذير
                            </button>
                            <button
                                onClick={() => handleTakeAction('message_deleted')}
                                className="action-option delete"
                            >
                                🗑️ حذف الرسالة
                            </button>
                            <button
                                onClick={() => handleTakeAction('user_suspended')}
                                className="action-option suspend"
                            >
                                🔒 تعليق المستخدم
                            </button>
                            <button
                                onClick={() => handleTakeAction('user_banned')}
                                className="action-option ban"
                            >
                                🚫 حظر المستخدم
                            </button>
                            <button
                                onClick={() => handleTakeAction('conversation_locked')}
                                className="action-option lock"
                            >
                                🔐 قفل المحادثة
                            </button>
                            <button
                                onClick={() => handleTakeAction('none')}
                                className="action-option none"
                            >
                                ❌ لا إجراء
                            </button>
                        </div>

                        <button
                            onClick={() => setShowActionModal(false)}
                            className="modal-close-btn"
                        >
                            إغلاق
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Reports;

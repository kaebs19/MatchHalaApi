import React, { useState, useEffect } from 'react';
import { getConversationById, getConversationReports } from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import { formatDateTimeLong } from '../utils/formatters';
import ConversationMessages from './ConversationMessages';
import './ConversationDetail.css';

function ConversationDetail({ conversationId, onBack }) {
    const [conversation, setConversation] = useState(null);
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('info');
    const [viewingMessages, setViewingMessages] = useState(false);
    const { showToast } = useToast();

    useEffect(() => {
        fetchConversationDetails();
    }, [conversationId]);

    const fetchConversationDetails = async () => {
        try {
            setLoading(true);
            const response = await getConversationById(conversationId);
            if (response.success) {
                setConversation(response.data);
            }

            // جلب البلاغات الخاصة بالمحادثة
            try {
                const reportsResponse = await getConversationReports(conversationId);
                if (reportsResponse.success) {
                    setReports(reportsResponse.data);
                }
            } catch (err) {
                console.log('لا توجد بلاغات لهذه المحادثة');
            }
        } catch (err) {
            console.error('خطأ في جلب تفاصيل المحادثة:', err);
            showToast('فشل تحميل التفاصيل', 'error');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <LoadingSpinner text="جاري تحميل التفاصيل..." />;
    }

    if (!conversation) {
        return (
            <div className="conversation-detail-page">
                <button onClick={onBack} className="back-btn">← رجوع</button>
                <div className="error-message">المحادثة غير موجودة</div>
            </div>
        );
    }

    // إذا كنا نعرض الرسائل
    if (viewingMessages) {
        return (
            <ConversationMessages
                conversationId={conversationId}
                onBack={() => setViewingMessages(false)}
            />
        );
    }

    return (
        <div className="conversation-detail-page">
            {/* Header */}
            <div className="detail-header">
                <button onClick={onBack} className="back-btn">← رجوع</button>
                <h2>{conversation.title}</h2>
                <button
                    onClick={() => setViewingMessages(true)}
                    className="view-messages-btn"
                >
                    💬 عرض الرسائل
                </button>
            </div>

            {/* Tabs */}
            <div className="detail-tabs">
                <button
                    className={`tab ${activeTab === 'info' ? 'active' : ''}`}
                    onClick={() => setActiveTab('info')}
                >
                    📋 المعلومات
                </button>
                <button
                    className={`tab ${activeTab === 'participants' ? 'active' : ''}`}
                    onClick={() => setActiveTab('participants')}
                >
                    👥 المشاركين ({conversation.participants?.length || 0})
                </button>
                <button
                    className={`tab ${activeTab === 'reports' ? 'active' : ''}`}
                    onClick={() => setActiveTab('reports')}
                >
                    ⚠️ البلاغات ({reports.length})
                </button>
                <button
                    className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    ⚙️ الإعدادات
                </button>
            </div>

            {/* Content */}
            <div className="detail-content">
                {/* Info Tab */}
                {activeTab === 'info' && (
                    <div className="tab-content">
                        <div className="info-grid">
                            <div className="info-card">
                                <h3>معلومات عامة</h3>
                                <div className="info-item">
                                    <span className="label">النوع:</span>
                                    <span className="value">
                                        {conversation.type === 'private' ? '👤 خاصة' : '👥 قروب'}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="label">الحالة:</span>
                                    <span className={`badge ${conversation.isActive ? 'active' : 'inactive'}`}>
                                        {conversation.isActive ? '● نشط' : '○ غير نشط'}
                                    </span>
                                </div>
                                <div className="info-item">
                                    <span className="label">القفل:</span>
                                    <span className="value">
                                        {conversation.isLocked ? '🔒 مقفل' : '🔓 مفتوح'}
                                    </span>
                                </div>
                                {conversation.description && (
                                    <div className="info-item">
                                        <span className="label">الوصف:</span>
                                        <span className="value">{conversation.description}</span>
                                    </div>
                                )}
                            </div>

                            <div className="info-card">
                                <h3>إحصائيات</h3>
                                <div className="stats-list">
                                    <div className="stat-item">
                                        <span className="icon">👥</span>
                                        <div>
                                            <div className="stat-value">{conversation.metadata?.totalParticipants || 0}</div>
                                            <div className="stat-label">إجمالي المشاركين</div>
                                        </div>
                                    </div>
                                    <div className="stat-item">
                                        <span className="icon">✅</span>
                                        <div>
                                            <div className="stat-value">{conversation.metadata?.activeMembers || 0}</div>
                                            <div className="stat-label">أعضاء نشطين</div>
                                        </div>
                                    </div>
                                    <div className="stat-item">
                                        <span className="icon">📨</span>
                                        <div>
                                            <div className="stat-value">{conversation.metadata?.totalMessages || 0}</div>
                                            <div className="stat-label">إجمالي الرسائل</div>
                                        </div>
                                    </div>
                                    <div className="stat-item">
                                        <span className="icon">⚠️</span>
                                        <div>
                                            <div className="stat-value">{conversation.metadata?.totalReports || 0}</div>
                                            <div className="stat-label">البلاغات</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="info-card">
                                <h3>التواريخ</h3>
                                <div className="info-item">
                                    <span className="label">تاريخ الإنشاء:</span>
                                    <span className="value">{formatDateTimeLong(conversation.createdAt)}</span>
                                </div>
                                <div className="info-item">
                                    <span className="label">آخر تحديث:</span>
                                    <span className="value">{formatDateTimeLong(conversation.updatedAt)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Participants Tab */}
                {activeTab === 'participants' && (
                    <div className="tab-content">
                        <h3>قائمة المشاركين</h3>
                        <div className="participants-grid">
                            {conversation.participants?.map((participant, index) => (
                                <div key={index} className="participant-card">
                                    <div className="participant-avatar">
                                        {participant.name?.charAt(0) || '?'}
                                    </div>
                                    <div className="participant-info">
                                        <h4>{participant.name}</h4>
                                        <p>{participant.email}</p>
                                        {conversation.admins?.some(admin => admin._id === participant._id) && (
                                            <span className="admin-badge">👑 مشرف</span>
                                        )}
                                        {conversation.creator === participant._id && (
                                            <span className="creator-badge">⭐ المنشئ</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reports Tab */}
                {activeTab === 'reports' && (
                    <div className="tab-content">
                        <h3>البلاغات المتعلقة بالمحادثة</h3>
                        {reports.length === 0 ? (
                            <div className="empty-state">
                                <p>لا توجد بلاغات لهذه المحادثة</p>
                            </div>
                        ) : (
                            <div className="reports-list">
                                {reports.map((report) => (
                                    <div key={report._id} className="report-item">
                                        <div className="report-header">
                                            <span className={`status-badge ${report.status}`}>
                                                {report.status === 'pending' && '⏳ قيد الانتظار'}
                                                {report.status === 'reviewing' && '👁️ قيد المراجعة'}
                                                {report.status === 'resolved' && '✅ تم الحل'}
                                                {report.status === 'rejected' && '❌ مرفوض'}
                                            </span>
                                            <span className={`priority-badge ${report.priority}`}>
                                                {report.priority}
                                            </span>
                                        </div>
                                        <div className="report-body">
                                            <p><strong>الفئة:</strong> {report.category}</p>
                                            <p><strong>الوصف:</strong> {report.description}</p>
                                            <p><strong>تاريخ البلاغ:</strong> {formatDateTimeLong(report.createdAt)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="tab-content">
                        <h3>إعدادات المحادثة</h3>
                        <div className="settings-list">
                            <div className="setting-item">
                                <div className="setting-info">
                                    <strong>السماح للأعضاء بالإرسال</strong>
                                    <p>هل يمكن للأعضاء إرسال رسائل في المحادثة</p>
                                </div>
                                <div className={`setting-value ${conversation.settings?.allowMembersToSend ? 'enabled' : 'disabled'}`}>
                                    {conversation.settings?.allowMembersToSend ? '✅ مفعل' : '❌ معطل'}
                                </div>
                            </div>

                            <div className="setting-item">
                                <div className="setting-info">
                                    <strong>السماح بإضافة أعضاء</strong>
                                    <p>هل يمكن للأعضاء إضافة مستخدمين آخرين</p>
                                </div>
                                <div className={`setting-value ${conversation.settings?.allowMembersToAddOthers ? 'enabled' : 'disabled'}`}>
                                    {conversation.settings?.allowMembersToAddOthers ? '✅ مفعل' : '❌ معطل'}
                                </div>
                            </div>

                            <div className="setting-item">
                                <div className="setting-info">
                                    <strong>حذف الرسائل تلقائياً</strong>
                                    <p>حذف الرسائل القديمة بشكل تلقائي</p>
                                </div>
                                <div className={`setting-value ${conversation.settings?.autoDeleteMessages ? 'enabled' : 'disabled'}`}>
                                    {conversation.settings?.autoDeleteMessages ? '✅ مفعل' : '❌ معطل'}
                                </div>
                            </div>

                            {conversation.settings?.autoDeleteMessages && (
                                <div className="setting-item">
                                    <div className="setting-info">
                                        <strong>مدة الحذف التلقائي</strong>
                                        <p>عدد الأيام قبل الحذف</p>
                                    </div>
                                    <div className="setting-value">
                                        {conversation.settings?.autoDeleteDays} يوم
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ConversationDetail;

import React, { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import config from '../config';
import './MaintenancePage.css';

function MaintenancePage() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [enabled, setEnabled] = useState(false);
    const [details, setDetails] = useState(null);
    const [messageAr, setMessageAr] = useState('نقوم بصيانة دورية لتحسين الخدمة. سنعود قريباً!');
    const [messageEn, setMessageEn] = useState('We are performing scheduled maintenance. We will be back soon!');
    const [duration, setDuration] = useState(30);
    const [allowAdmin, setAllowAdmin] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => { fetchStatus(); }, []);

    const fetchStatus = async () => {
        try {
            setLoading(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${config.API_URL}/maintenance/admin/details`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                setDetails(data.data);
                setEnabled(!!data.data.enabled);
                if (data.data.messageAr) setMessageAr(data.data.messageAr);
                if (data.data.messageEn) setMessageEn(data.data.messageEn);
            }
        } catch (err) {
            showToast('فشل تحميل حالة الصيانة', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleEnable = async () => {
        if (!window.confirm('هل أنت متأكد من تفعيل وضع الصيانة؟ سيتم منع المستخدمين من الوصول للتطبيق.')) return;
        try {
            setSubmitting(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${config.API_URL}/maintenance/enable`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    messageAr,
                    messageEn,
                    durationMinutes: duration,
                    allowAdmin
                })
            });
            const data = await res.json();
            if (data.success) {
                showToast('تم تفعيل وضع الصيانة', 'success');
                fetchStatus();
            } else {
                showToast(data.message || 'فشل التفعيل', 'error');
            }
        } catch (err) {
            showToast('خطأ في الشبكة', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDisable = async () => {
        if (!window.confirm('هل أنت متأكد من إلغاء وضع الصيانة؟')) return;
        try {
            setSubmitting(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${config.API_URL}/maintenance/disable`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                showToast('تم إلغاء وضع الصيانة', 'success');
                fetchStatus();
            }
        } catch (err) {
            showToast('خطأ في الشبكة', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return <div className="maint-loading">جاري التحميل...</div>;
    }

    return (
        <div className="maintenance-page">
            <div className="maint-header">
                <h1>🔧 وضع الصيانة</h1>
                <p>تحكم في إيقاف/تشغيل التطبيق للجميع</p>
            </div>

            {/* Status Card */}
            <div className={`status-card ${enabled ? 'active' : 'inactive'}`}>
                <div className="status-icon">
                    {enabled ? '🔴' : '🟢'}
                </div>
                <div className="status-info">
                    <h2>{enabled ? 'وضع الصيانة مفعّل' : 'التطبيق يعمل بشكل طبيعي'}</h2>
                    {enabled && details && (
                        <div className="status-details">
                            {details.startedAt && (
                                <p>📅 بدأت: {new Date(details.startedAt).toLocaleString('ar')}</p>
                            )}
                            {details.estimatedEndAt && (
                                <p>⏰ متوقع الانتهاء: {new Date(details.estimatedEndAt).toLocaleString('ar')}</p>
                            )}
                            {details.startedBy && (
                                <p>👤 بدأها: {details.startedBy.name || details.startedBy}</p>
                            )}
                            {details.triggerType === 'auto' && (
                                <p>⚡ تفعيل تلقائي بسبب فشل في السيرفر</p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Form */}
            {!enabled && (
                <div className="maint-form">
                    <h3>تفعيل وضع الصيانة</h3>

                    <div className="form-group">
                        <label>الرسالة بالعربية</label>
                        <textarea
                            value={messageAr}
                            onChange={(e) => setMessageAr(e.target.value)}
                            rows={3}
                            dir="rtl"
                            placeholder="نقوم بصيانة دورية..."
                        />
                    </div>

                    <div className="form-group">
                        <label>Message (English)</label>
                        <textarea
                            value={messageEn}
                            onChange={(e) => setMessageEn(e.target.value)}
                            rows={3}
                            dir="ltr"
                            placeholder="We are performing maintenance..."
                        />
                    </div>

                    <div className="form-group">
                        <label>المدة المتوقعة</label>
                        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                            <option value={5}>5 دقائق</option>
                            <option value={15}>15 دقيقة</option>
                            <option value={30}>30 دقيقة</option>
                            <option value={60}>ساعة</option>
                            <option value={120}>ساعتين</option>
                            <option value={240}>4 ساعات</option>
                            <option value={0}>غير محدد</option>
                        </select>
                    </div>

                    <div className="form-group checkbox-group">
                        <label>
                            <input
                                type="checkbox"
                                checked={allowAdmin}
                                onChange={(e) => setAllowAdmin(e.target.checked)}
                            />
                            <span>السماح للأدمن بالوصول حتى في وضع الصيانة</span>
                        </label>
                    </div>

                    <button
                        className="btn-enable"
                        onClick={handleEnable}
                        disabled={submitting}
                    >
                        {submitting ? '⏳ جاري التفعيل...' : '🔧 تفعيل وضع الصيانة'}
                    </button>
                </div>
            )}

            {enabled && (
                <div className="maint-form">
                    <button
                        className="btn-disable"
                        onClick={handleDisable}
                        disabled={submitting}
                    >
                        {submitting ? '⏳ جاري الإلغاء...' : '✅ إلغاء وضع الصيانة'}
                    </button>
                </div>
            )}

            {/* Info Card */}
            <div className="info-card">
                <h4>ℹ️ كيف يعمل وضع الصيانة؟</h4>
                <ul>
                    <li>⛔ كل الـ APIs ترجع 503 Service Unavailable</li>
                    <li>📱 التطبيق يعرض شاشة صيانة جميلة للمستخدمين</li>
                    <li>🔔 يتم إرسال إشعار push لكل المستخدمين</li>
                    <li>📡 الـ Socket يبث الحدث فوراً للمتصلين حالياً</li>
                    <li>🔄 التطبيق يتحقق تلقائياً كل 30 ثانية من العودة</li>
                    <li>👤 الأدمن يستطيع الاستمرار (إذا فعّلت الخيار)</li>
                </ul>
            </div>
        </div>
    );
}

export default MaintenancePage;

import React, { useState, useEffect } from 'react';
import {
    getSettings, updateSettings, updatePageContent, changePassword, updateProfile, uploadProfileImage,
    getVersionControl, updateVersionControl, getBannedNames, addBannedNames, deleteBannedName, updateMaxViolations
} from '../services/api';
import { useToast } from '../components/Toast';
import LoadingSpinner from '../components/LoadingSpinner';
import ImageUpload from '../components/ImageUpload';
import './Settings.css';

function Settings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeTab, setActiveTab] = useState('profile'); // profile, password, pages, app, version, banned-names
    const { showToast } = useToast();

    // بيانات المستخدم
    const [userData, setUserData] = useState({
        name: '',
        email: '',
        profileImage: null
    });

    // تغيير كلمة المرور
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });

    // إعدادات التطبيق
    const [appSettings, setAppSettings] = useState({
        appName: '',
        appVersion: '',
        contactEmail: '',
        contactPhone: '',
        websiteUrl: ''
    });

    // محتوى الصفحات
    const [pageContents, setPageContents] = useState({
        privacyPolicy: '',
        termsOfService: '',
        aboutApp: '',
        contactUs: ''
    });

    // ✅ إعدادات التحكم بالإصدار
    const [versionControl, setVersionControl] = useState({
        minRequiredVersion: '1.0',
        latestVersion: '2.4',
        iosStoreURL: '',
        updateMessageAr: '',
        updateMessageEn: '',
        enforceUpdate: false
    });

    // ✅ الأسماء المحظورة
    const [bannedNames, setBannedNames] = useState([]);
    const [newBannedName, setNewBannedName] = useState('');
    const [bannedNameReason, setBannedNameReason] = useState('');
    const [maxViolations, setMaxViolations] = useState(3);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);

            // جلب بيانات المستخدم من localStorage
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            setUserData({
                name: user.name || '',
                email: user.email || '',
                profileImage: user.profileImage || null
            });

            // جلب الإعدادات
            try {
                const response = await getSettings();
                if (response.success) {
                    const settings = response.data;
                    setAppSettings({
                        appName: settings.appName || 'MatchHala',
                        appVersion: settings.appVersion || '1.0.0',
                        contactEmail: settings.contactEmail || '',
                        contactPhone: settings.contactPhone || '',
                        websiteUrl: settings.websiteUrl || ''
                    });

                    setPageContents({
                        privacyPolicy: settings.privacyPolicy || '',
                        termsOfService: settings.termsOfService || '',
                        aboutApp: settings.aboutApp || '',
                        contactUs: settings.contactUs || ''
                    });
                }
            } catch (settingsErr) {
                console.log('استخدام القيم الافتراضية للإعدادات');
                // استخدام قيم افتراضية
                setAppSettings({
                    appName: 'MatchHala',
                    appVersion: '1.0.0',
                    contactEmail: '',
                    contactPhone: '',
                    websiteUrl: ''
                });
            }
        } catch (err) {
            console.error('خطأ في جلب البيانات:', err);
            showToast('تم تحميل البيانات الأساسية', 'warning');
        } finally {
            setLoading(false);
        }
    };

    // رفع صورة الملف الشخصي
    const handleUploadProfileImage = async (file) => {
        try {
            const response = await uploadProfileImage(file);

            if (response.success) {
                // تحديث الصورة في state
                setUserData(prev => ({
                    ...prev,
                    profileImage: response.data.profileImage
                }));

                // تحديث localStorage
                const user = JSON.parse(localStorage.getItem('user') || '{}');
                user.profileImage = response.data.profileImage;
                localStorage.setItem('user', JSON.stringify(user));

                showToast('تم رفع الصورة بنجاح ✅', 'success');
            }
        } catch (error) {
            console.error('خطأ في رفع الصورة:', error);
            showToast(error.response?.data?.message || 'فشل رفع الصورة', 'error');
            throw error; // لإعادة الصورة القديمة في المكون
        }
    };

    // تحديث بيانات المستخدم
    const handleUpdateProfile = async (e) => {
        e.preventDefault();

        if (!userData.name || !userData.email) {
            showToast('الاسم والبريد الإلكتروني مطلوبان', 'error');
            return;
        }

        try {
            setSaving(true);
            const response = await updateProfile(userData.name, userData.email);

            if (response.success) {
                // تحديث localStorage
                const user = JSON.parse(localStorage.getItem('user') || '{}');
                user.name = userData.name;
                user.email = userData.email;
                localStorage.setItem('user', JSON.stringify(user));

                showToast('تم تحديث البيانات بنجاح ✅', 'success');
            } else {
                showToast(response.message || 'فشل تحديث البيانات', 'error');
            }
        } catch (error) {
            console.error('خطأ في التحديث:', error);
            showToast('فشل تحديث البيانات', 'error');
        } finally {
            setSaving(false);
        }
    };

    // تغيير كلمة المرور
    const handleChangePassword = async (e) => {
        e.preventDefault();

        if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
            showToast('جميع الحقول مطلوبة', 'error');
            return;
        }

        if (passwordData.newPassword !== passwordData.confirmPassword) {
            showToast('كلمة المرور الجديدة غير متطابقة', 'error');
            return;
        }

        if (passwordData.newPassword.length < 6) {
            showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
            return;
        }

        try {
            setSaving(true);
            const response = await changePassword(passwordData.currentPassword, passwordData.newPassword);

            if (response.success) {
                showToast('تم تغيير كلمة المرور بنجاح ✅', 'success');
                setPasswordData({
                    currentPassword: '',
                    newPassword: '',
                    confirmPassword: ''
                });
            } else {
                showToast(response.message || 'فشل تغيير كلمة المرور', 'error');
            }
        } catch (error) {
            console.error('خطأ في تغيير كلمة المرور:', error);
            showToast(error.response?.data?.message || 'فشل تغيير كلمة المرور', 'error');
        } finally {
            setSaving(false);
        }
    };

    // تحديث محتوى صفحة
    const handleUpdatePageContent = async (type) => {
        const contentMap = {
            privacy: pageContents.privacyPolicy,
            terms: pageContents.termsOfService,
            about: pageContents.aboutApp,
            contact: pageContents.contactUs
        };

        const content = contentMap[type];
        if (!content) {
            showToast('المحتوى فارغ', 'error');
            return;
        }

        try {
            setSaving(true);
            const response = await updatePageContent(type, content);

            if (response.success) {
                showToast(`تم تحديث المحتوى بنجاح ✅`, 'success');
            } else {
                showToast(response.message || 'فشل تحديث المحتوى', 'error');
            }
        } catch (error) {
            console.error('خطأ في التحديث:', error);
            showToast('فشل تحديث المحتوى', 'error');
        } finally {
            setSaving(false);
        }
    };

    // تحديث إعدادات التطبيق
    const handleUpdateAppSettings = async (e) => {
        e.preventDefault();

        try {
            setSaving(true);
            const response = await updateSettings(appSettings);

            if (response.success) {
                showToast('تم تحديث إعدادات التطبيق بنجاح ✅', 'success');
            } else {
                showToast(response.message || 'فشل تحديث الإعدادات', 'error');
            }
        } catch (error) {
            console.error('خطأ في التحديث:', error);
            showToast('فشل تحديث الإعدادات', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ✅ جلب إعدادات الإصدار
    const fetchVersionControl = async () => {
        try {
            const response = await getVersionControl();
            if (response.success && response.data?.appVersionControl) {
                setVersionControl(response.data.appVersionControl);
            }
        } catch (err) {
            console.log('استخدام قيم افتراضية للإصدار');
        }
    };

    // ✅ حفظ إعدادات الإصدار
    const handleSaveVersionControl = async (e) => {
        e.preventDefault();
        try {
            setSaving(true);
            const response = await updateVersionControl(versionControl);
            if (response.success) {
                showToast('تم تحديث إعدادات الإصدار ✅', 'success');
            } else {
                showToast(response.message || 'فشل التحديث', 'error');
            }
        } catch (error) {
            showToast('فشل تحديث إعدادات الإصدار', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ✅ جلب الأسماء المحظورة
    const fetchBannedNames = async () => {
        try {
            const response = await getBannedNames();
            if (response.success) {
                setBannedNames(response.data?.bannedNames || []);
            }
        } catch (err) {
            console.log('فشل جلب الأسماء المحظورة');
        }
    };

    // ✅ إضافة اسم محظور
    const handleAddBannedName = async () => {
        if (!newBannedName.trim()) {
            showToast('أدخل الاسم المحظور', 'error');
            return;
        }
        try {
            setSaving(true);
            const names = newBannedName.split(',').map(n => n.trim()).filter(Boolean);
            const response = await addBannedNames(names, bannedNameReason || 'اسم غير لائق');
            if (response.success) {
                showToast(`تم إضافة ${response.data.added.length} اسم ✅`, 'success');
                setNewBannedName('');
                setBannedNameReason('');
                fetchBannedNames();
            }
        } catch (error) {
            showToast('فشل إضافة الاسم', 'error');
        } finally {
            setSaving(false);
        }
    };

    // ✅ حذف اسم محظور
    const handleDeleteBannedName = async (name) => {
        try {
            const response = await deleteBannedName(name);
            if (response.success) {
                showToast('تم حذف الاسم ✅', 'success');
                fetchBannedNames();
            }
        } catch (error) {
            showToast('فشل حذف الاسم', 'error');
        }
    };

    // ✅ تحديث حد المخالفات
    const handleUpdateMaxViolations = async () => {
        try {
            setSaving(true);
            const response = await updateMaxViolations(maxViolations);
            if (response.success) {
                showToast(`تم تحديث حد المخالفات إلى ${maxViolations} ✅`, 'success');
            }
        } catch (error) {
            showToast('فشل التحديث', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <LoadingSpinner text="جاري تحميل الإعدادات..." />;
    }

    return (
        <div className="settings-page">
            <div className="settings-header">
                <h1>⚙️ الإعدادات</h1>
                <p>إدارة إعدادات التطبيق والحساب</p>
            </div>

            {/* Tabs */}
            <div className="settings-tabs">
                <button
                    className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
                    onClick={() => setActiveTab('profile')}
                >
                    👤 الملف الشخصي
                </button>
                <button
                    className={`tab-btn ${activeTab === 'password' ? 'active' : ''}`}
                    onClick={() => setActiveTab('password')}
                >
                    🔒 كلمة المرور
                </button>
                <button
                    className={`tab-btn ${activeTab === 'pages' ? 'active' : ''}`}
                    onClick={() => setActiveTab('pages')}
                >
                    📄 صفحات التطبيق
                </button>
                <button
                    className={`tab-btn ${activeTab === 'app' ? 'active' : ''}`}
                    onClick={() => setActiveTab('app')}
                >
                    🎨 إعدادات التطبيق
                </button>
                <button
                    className={`tab-btn ${activeTab === 'version' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('version'); fetchVersionControl(); }}
                >
                    📱 إدارة الإصدارات
                </button>
                <button
                    className={`tab-btn ${activeTab === 'banned-names' ? 'active' : ''}`}
                    onClick={() => { setActiveTab('banned-names'); fetchBannedNames(); }}
                >
                    🚫 أسماء محظورة
                </button>
            </div>

            {/* Content */}
            <div className="settings-content">
                {/* تبويب الملف الشخصي */}
                {activeTab === 'profile' && (
                    <div className="settings-section">
                        <h2>تحديث الملف الشخصي</h2>

                        {/* رفع صورة الملف الشخصي */}
                        <ImageUpload
                            currentImage={userData.profileImage}
                            onUpload={handleUploadProfileImage}
                            title="صورة الملف الشخصي"
                            type="profile"
                        />

                        <form onSubmit={handleUpdateProfile}>
                            <div className="form-group">
                                <label>الاسم</label>
                                <input
                                    type="text"
                                    value={userData.name}
                                    onChange={(e) => setUserData({ ...userData, name: e.target.value })}
                                    placeholder="أدخل اسمك"
                                />
                            </div>
                            <div className="form-group">
                                <label>البريد الإلكتروني</label>
                                <input
                                    type="email"
                                    value={userData.email}
                                    onChange={(e) => setUserData({ ...userData, email: e.target.value })}
                                    placeholder="أدخل بريدك الإلكتروني"
                                />
                            </div>
                            <button type="submit" className="btn-save" disabled={saving}>
                                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ التغييرات'}
                            </button>
                        </form>
                    </div>
                )}

                {/* تبويب كلمة المرور */}
                {activeTab === 'password' && (
                    <div className="settings-section">
                        <h2>تغيير كلمة المرور</h2>
                        <form onSubmit={handleChangePassword}>
                            <div className="form-group">
                                <label>كلمة المرور الحالية</label>
                                <input
                                    type="password"
                                    value={passwordData.currentPassword}
                                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                                    placeholder="أدخل كلمة المرور الحالية"
                                />
                            </div>
                            <div className="form-group">
                                <label>كلمة المرور الجديدة</label>
                                <input
                                    type="password"
                                    value={passwordData.newPassword}
                                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                                    placeholder="أدخل كلمة المرور الجديدة (6 أحرف على الأقل)"
                                />
                            </div>
                            <div className="form-group">
                                <label>تأكيد كلمة المرور الجديدة</label>
                                <input
                                    type="password"
                                    value={passwordData.confirmPassword}
                                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                                    placeholder="أعد إدخال كلمة المرور الجديدة"
                                />
                            </div>
                            <button type="submit" className="btn-save" disabled={saving}>
                                {saving ? '⏳ جاري التغيير...' : '🔐 تغيير كلمة المرور'}
                            </button>
                        </form>
                    </div>
                )}

                {/* تبويب صفحات التطبيق */}
                {activeTab === 'pages' && (
                    <div className="settings-section">
                        <h2>تعديل صفحات التطبيق</h2>

                        {/* سياسة الخصوصية */}
                        <div className="page-editor">
                            <h3>📜 سياسة الخصوصية</h3>
                            <textarea
                                rows="8"
                                value={pageContents.privacyPolicy}
                                onChange={(e) => setPageContents({ ...pageContents, privacyPolicy: e.target.value })}
                                placeholder="أدخل محتوى سياسة الخصوصية (يدعم Markdown)"
                            />
                            <button
                                className="btn-save-page"
                                onClick={() => handleUpdatePageContent('privacy')}
                                disabled={saving}
                            >
                                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ سياسة الخصوصية'}
                            </button>
                        </div>

                        {/* شروط الاستخدام */}
                        <div className="page-editor">
                            <h3>📋 شروط الاستخدام</h3>
                            <textarea
                                rows="8"
                                value={pageContents.termsOfService}
                                onChange={(e) => setPageContents({ ...pageContents, termsOfService: e.target.value })}
                                placeholder="أدخل محتوى شروط الاستخدام (يدعم Markdown)"
                            />
                            <button
                                className="btn-save-page"
                                onClick={() => handleUpdatePageContent('terms')}
                                disabled={saving}
                            >
                                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ شروط الاستخدام'}
                            </button>
                        </div>

                        {/* حول التطبيق */}
                        <div className="page-editor">
                            <h3>ℹ️ حول التطبيق</h3>
                            <textarea
                                rows="8"
                                value={pageContents.aboutApp}
                                onChange={(e) => setPageContents({ ...pageContents, aboutApp: e.target.value })}
                                placeholder="أدخل محتوى حول التطبيق (يدعم Markdown)"
                            />
                            <button
                                className="btn-save-page"
                                onClick={() => handleUpdatePageContent('about')}
                                disabled={saving}
                            >
                                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ حول التطبيق'}
                            </button>
                        </div>

                        {/* اتصل بنا */}
                        <div className="page-editor">
                            <h3>📞 اتصل بنا</h3>
                            <textarea
                                rows="8"
                                value={pageContents.contactUs}
                                onChange={(e) => setPageContents({ ...pageContents, contactUs: e.target.value })}
                                placeholder="أدخل محتوى صفحة اتصل بنا (يدعم Markdown)"
                            />
                            <button
                                className="btn-save-page"
                                onClick={() => handleUpdatePageContent('contact')}
                                disabled={saving}
                            >
                                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ اتصل بنا'}
                            </button>
                        </div>
                    </div>
                )}

                {/* تبويب إعدادات التطبيق */}
                {activeTab === 'app' && (
                    <div className="settings-section">
                        <h2>إعدادات التطبيق العامة</h2>
                        <form onSubmit={handleUpdateAppSettings}>
                            <div className="form-group">
                                <label>اسم التطبيق</label>
                                <input
                                    type="text"
                                    value={appSettings.appName}
                                    onChange={(e) => setAppSettings({ ...appSettings, appName: e.target.value })}
                                    placeholder="مثال: MatchHala"
                                />
                            </div>
                            <div className="form-group">
                                <label>رقم الإصدار</label>
                                <input
                                    type="text"
                                    value={appSettings.appVersion}
                                    onChange={(e) => setAppSettings({ ...appSettings, appVersion: e.target.value })}
                                    placeholder="مثال: 1.0.0"
                                />
                            </div>
                            <div className="form-group">
                                <label>البريد الإلكتروني للدعم</label>
                                <input
                                    type="email"
                                    value={appSettings.contactEmail}
                                    onChange={(e) => setAppSettings({ ...appSettings, contactEmail: e.target.value })}
                                    placeholder="مثال: support@matchhala.com"
                                />
                            </div>
                            <div className="form-group">
                                <label>رقم الهاتف</label>
                                <input
                                    type="tel"
                                    value={appSettings.contactPhone}
                                    onChange={(e) => setAppSettings({ ...appSettings, contactPhone: e.target.value })}
                                    placeholder="مثال: +966xxxxxxxxx"
                                />
                            </div>
                            <div className="form-group">
                                <label>رابط الموقع</label>
                                <input
                                    type="url"
                                    value={appSettings.websiteUrl}
                                    onChange={(e) => setAppSettings({ ...appSettings, websiteUrl: e.target.value })}
                                    placeholder="مثال: https://matchhala.com"
                                />
                            </div>
                            <button type="submit" className="btn-save" disabled={saving}>
                                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ الإعدادات'}
                            </button>
                        </form>
                    </div>
                )}
                {/* ✅ تبويب إدارة الإصدارات */}
                {activeTab === 'version' && (
                    <div className="settings-section">
                        <h2>📱 التحكم بإصدارات التطبيق</h2>
                        <p style={{ color: '#888', marginBottom: '20px' }}>
                            تحكم في إجبار المستخدمين على تحديث التطبيق عندما تنشر نسخة جديدة
                        </p>

                        <form onSubmit={handleSaveVersionControl}>
                            {/* تفعيل/تعطيل */}
                            <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <label style={{ marginBottom: 0 }}>تفعيل التحديث الإجباري</label>
                                <button
                                    type="button"
                                    className={`btn-toggle ${versionControl.enforceUpdate ? 'active' : ''}`}
                                    onClick={() => setVersionControl({ ...versionControl, enforceUpdate: !versionControl.enforceUpdate })}
                                    style={{
                                        padding: '6px 16px',
                                        borderRadius: '20px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        background: versionControl.enforceUpdate ? '#22c55e' : '#ef4444',
                                        color: '#fff'
                                    }}
                                >
                                    {versionControl.enforceUpdate ? '✅ مفعّل' : '❌ معطّل'}
                                </button>
                            </div>

                            <div className="form-group">
                                <label>الحد الأدنى المطلوب (أقل من هذا = تحديث إجباري)</label>
                                <input
                                    type="text"
                                    value={versionControl.minRequiredVersion}
                                    onChange={(e) => setVersionControl({ ...versionControl, minRequiredVersion: e.target.value })}
                                    placeholder="مثال: 2.4"
                                />
                            </div>

                            <div className="form-group">
                                <label>أحدث إصدار متاح</label>
                                <input
                                    type="text"
                                    value={versionControl.latestVersion}
                                    onChange={(e) => setVersionControl({ ...versionControl, latestVersion: e.target.value })}
                                    placeholder="مثال: 2.5"
                                />
                            </div>

                            <div className="form-group">
                                <label>رابط المتجر (App Store)</label>
                                <input
                                    type="url"
                                    value={versionControl.iosStoreURL}
                                    onChange={(e) => setVersionControl({ ...versionControl, iosStoreURL: e.target.value })}
                                    placeholder="https://apps.apple.com/app/id..."
                                    dir="ltr"
                                />
                            </div>

                            <div className="form-group">
                                <label>رسالة التحديث (عربي)</label>
                                <textarea
                                    rows="2"
                                    value={versionControl.updateMessageAr}
                                    onChange={(e) => setVersionControl({ ...versionControl, updateMessageAr: e.target.value })}
                                    placeholder="يجب تحديث التطبيق للاستمرار..."
                                />
                            </div>

                            <div className="form-group">
                                <label>رسالة التحديث (إنجليزي)</label>
                                <textarea
                                    rows="2"
                                    value={versionControl.updateMessageEn}
                                    onChange={(e) => setVersionControl({ ...versionControl, updateMessageEn: e.target.value })}
                                    placeholder="Please update the app to continue..."
                                    dir="ltr"
                                />
                            </div>

                            <button type="submit" className="btn-save" disabled={saving}>
                                {saving ? '⏳ جاري الحفظ...' : '💾 حفظ إعدادات الإصدار'}
                            </button>
                        </form>

                        {/* معلومات */}
                        <div style={{ marginTop: '24px', padding: '16px', background: '#fef3c7', borderRadius: '12px', border: '1px solid #fbbf24' }}>
                            <p style={{ margin: 0, color: '#92400e', fontWeight: 'bold' }}>⚠️ تنبيه:</p>
                            <p style={{ margin: '8px 0 0', color: '#92400e', fontSize: '14px' }}>
                                عند تفعيل التحديث الإجباري، أي مستخدم بإصدار أقل من الحد الأدنى لن يستطيع استخدام التطبيق حتى يحدّث.
                                تأكد أن النسخة الجديدة متاحة على المتجر قبل التفعيل.
                            </p>
                        </div>
                    </div>
                )}

                {/* ✅ تبويب الأسماء المحظورة */}
                {activeTab === 'banned-names' && (
                    <div className="settings-section">
                        <h2>🚫 الأسماء المحظورة + حد المخالفات</h2>

                        {/* حد المخالفات */}
                        <div style={{ marginBottom: '24px', padding: '16px', background: '#fef2f2', borderRadius: '12px', border: '1px solid #fca5a5' }}>
                            <h3 style={{ margin: '0 0 12px', color: '#dc2626' }}>🔢 حد المخالفات قبل الحظر التلقائي</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={maxViolations}
                                    onChange={(e) => setMaxViolations(parseInt(e.target.value) || 3)}
                                    style={{ width: '80px', textAlign: 'center', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }}
                                />
                                <span style={{ color: '#666' }}>مخالفات</span>
                                <button
                                    onClick={handleUpdateMaxViolations}
                                    className="btn-save"
                                    disabled={saving}
                                    style={{ padding: '8px 16px', fontSize: '14px' }}
                                >
                                    {saving ? '⏳' : '💾 حفظ'}
                                </button>
                            </div>
                        </div>

                        {/* إضافة اسم جديد */}
                        <div style={{ marginBottom: '24px' }}>
                            <h3>➕ إضافة أسماء محظورة</h3>
                            <p style={{ color: '#888', fontSize: '13px', marginBottom: '12px' }}>
                                يمكنك إضافة عدة أسماء بفاصلة (مثل: اسم1, اسم2, اسم3)
                            </p>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <input
                                    type="text"
                                    value={newBannedName}
                                    onChange={(e) => setNewBannedName(e.target.value)}
                                    placeholder="الأسماء المحظورة"
                                    style={{ flex: 1, minWidth: '200px', padding: '10px', borderRadius: '8px', border: '1px solid #ddd' }}
                                />
                                <input
                                    type="text"
                                    value={bannedNameReason}
                                    onChange={(e) => setBannedNameReason(e.target.value)}
                                    placeholder="السبب (اختياري)"
                                    style={{ width: '200px', padding: '10px', borderRadius: '8px', border: '1px solid #ddd' }}
                                />
                                <button
                                    onClick={handleAddBannedName}
                                    className="btn-save"
                                    disabled={saving}
                                    style={{ padding: '10px 20px' }}
                                >
                                    {saving ? '⏳' : '➕ إضافة'}
                                </button>
                            </div>
                        </div>

                        {/* قائمة الأسماء المحظورة */}
                        <div>
                            <h3>📋 قائمة الأسماء المحظورة ({bannedNames.length})</h3>
                            {bannedNames.length === 0 ? (
                                <p style={{ color: '#888', textAlign: 'center', padding: '20px' }}>لا توجد أسماء محظورة</p>
                            ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                                    {bannedNames.map((bn, idx) => (
                                        <div key={idx} style={{
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                            padding: '8px 14px', background: '#fef2f2', borderRadius: '20px',
                                            border: '1px solid #fca5a5', fontSize: '14px'
                                        }}>
                                            <span style={{ color: '#dc2626', fontWeight: 'bold' }}>{bn.name}</span>
                                            {bn.reason && <span style={{ color: '#888', fontSize: '12px' }}>({bn.reason})</span>}
                                            <button
                                                onClick={() => handleDeleteBannedName(bn.name)}
                                                style={{
                                                    background: 'none', border: 'none', color: '#dc2626',
                                                    cursor: 'pointer', fontSize: '16px', padding: '0 4px'
                                                }}
                                                title="حذف"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Settings;

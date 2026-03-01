import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { getImageUrl, getDefaultAvatar } from '../config';
import { useToast } from '../components/Toast';
import './Profile.css';

function Profile({ user, onUserUpdate }) {
    const { showToast } = useToast();
    const [isEditing, setIsEditing] = useState(false);
    const [loading, setLoading] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        bio: user?.bio || '',
        country: user?.country || '',
        gender: user?.gender || ''
    });
    const [passwordData, setPasswordData] = useState({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [showPasswordForm, setShowPasswordForm] = useState(false);

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.name || '',
                email: user.email || '',
                bio: user.bio || '',
                country: user.country || '',
                gender: user.gender || ''
            });
        }
    }, [user]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handlePasswordChange = (e) => {
        const { name, value } = e.target;
        setPasswordData(prev => ({ ...prev, [name]: value }));
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // التحقق من نوع الملف
        if (!file.type.startsWith('image/')) {
            showToast('يرجى اختيار ملف صورة صالح', 'error');
            return;
        }

        // التحقق من حجم الملف (5MB max)
        if (file.size > 5 * 1024 * 1024) {
            showToast('حجم الصورة يجب أن يكون أقل من 5 ميجابايت', 'error');
            return;
        }

        setUploadingImage(true);
        const formData = new FormData();
        formData.append('profileImage', file);

        try {
            const response = await api.post('/auth/upload-profile-image', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (response.data.success) {
                showToast('تم تحديث الصورة بنجاح', 'success');
                if (onUserUpdate) {
                    onUserUpdate(response.data.data.user);
                }
                // تحديث localStorage
                const savedUser = JSON.parse(localStorage.getItem('user') || '{}');
                savedUser.profileImage = response.data.data.profileImage;
                localStorage.setItem('user', JSON.stringify(savedUser));
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في رفع الصورة', 'error');
        } finally {
            setUploadingImage(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const response = await api.put('/auth/update-profile', formData);

            if (response.data.success) {
                showToast('تم تحديث البيانات بنجاح', 'success');
                setIsEditing(false);
                if (onUserUpdate) {
                    onUserUpdate(response.data.data.user);
                }
                // تحديث localStorage
                localStorage.setItem('user', JSON.stringify(response.data.data.user));
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تحديث البيانات', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordSubmit = async (e) => {
        e.preventDefault();

        if (passwordData.newPassword !== passwordData.confirmPassword) {
            showToast('كلمة المرور الجديدة غير متطابقة', 'error');
            return;
        }

        if (passwordData.newPassword.length < 6) {
            showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error');
            return;
        }

        setLoading(true);

        try {
            const response = await api.put('/auth/change-password', {
                currentPassword: passwordData.currentPassword,
                newPassword: passwordData.newPassword
            });

            if (response.data.success) {
                showToast('تم تغيير كلمة المرور بنجاح', 'success');
                setShowPasswordForm(false);
                setPasswordData({
                    currentPassword: '',
                    newPassword: '',
                    confirmPassword: ''
                });
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'فشل في تغيير كلمة المرور', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="profile-page">
            <div className="profile-container">
                {/* قسم الصورة والمعلومات الأساسية */}
                <div className="profile-header-section">
                    <div className="profile-image-wrapper">
                        <img
                            src={user?.profileImage ? getImageUrl(user.profileImage) : getDefaultAvatar(user?.name)}
                            alt={user?.name}
                            className="profile-image"
                            onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = getDefaultAvatar(user?.name);
                            }}
                        />
                        <label className="upload-overlay" htmlFor="profile-image-input">
                            {uploadingImage ? (
                                <span className="upload-spinner"></span>
                            ) : (
                                <span>📷 تغيير الصورة</span>
                            )}
                        </label>
                        <input
                            type="file"
                            id="profile-image-input"
                            accept="image/*"
                            onChange={handleImageUpload}
                            disabled={uploadingImage}
                            style={{ display: 'none' }}
                        />
                    </div>
                    <div className="profile-basic-info">
                        <h2>{user?.name}</h2>
                        <p className="profile-email">{user?.email}</p>
                        <span className={`role-badge ${user?.role}`}>
                            {user?.role === 'admin' ? 'مدير' : 'مستخدم'}
                        </span>
                    </div>
                </div>

                {/* معلومات الحساب */}
                <div className="profile-section">
                    <div className="section-header">
                        <h3>معلومات الحساب</h3>
                        {!isEditing && (
                            <button className="edit-btn" onClick={() => setIsEditing(true)}>
                                تعديل
                            </button>
                        )}
                    </div>

                    {isEditing ? (
                        <form onSubmit={handleSubmit} className="profile-form">
                            <div className="form-group">
                                <label>الاسم</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>البريد الإلكتروني</label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>النبذة</label>
                                <textarea
                                    name="bio"
                                    value={formData.bio}
                                    onChange={handleInputChange}
                                    placeholder="اكتب نبذة عنك..."
                                    rows={3}
                                />
                            </div>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>البلد</label>
                                    <input
                                        type="text"
                                        name="country"
                                        value={formData.country}
                                        onChange={handleInputChange}
                                        placeholder="مثال: السعودية"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>الجنس</label>
                                    <select name="gender" value={formData.gender} onChange={handleInputChange}>
                                        <option value="">اختر...</option>
                                        <option value="male">ذكر</option>
                                        <option value="female">أنثى</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-actions">
                                <button type="submit" className="save-btn" disabled={loading}>
                                    {loading ? 'جاري الحفظ...' : 'حفظ التغييرات'}
                                </button>
                                <button type="button" className="cancel-btn" onClick={() => setIsEditing(false)}>
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="profile-info-grid">
                            <div className="info-item">
                                <span className="info-label">الاسم</span>
                                <span className="info-value">{user?.name || '-'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">البريد الإلكتروني</span>
                                <span className="info-value">{user?.email || '-'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">النبذة</span>
                                <span className="info-value">{user?.bio || 'لم يتم إضافة نبذة'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">البلد</span>
                                <span className="info-value">{user?.country || '-'}</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">الجنس</span>
                                <span className="info-value">
                                    {user?.gender === 'male' ? 'ذكر' : user?.gender === 'female' ? 'أنثى' : '-'}
                                </span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">تاريخ التسجيل</span>
                                <span className="info-value">
                                    {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('ar-SA') : '-'}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* قسم كلمة المرور */}
                <div className="profile-section">
                    <div className="section-header">
                        <h3>الأمان</h3>
                        {!showPasswordForm && (
                            <button className="edit-btn" onClick={() => setShowPasswordForm(true)}>
                                تغيير كلمة المرور
                            </button>
                        )}
                    </div>

                    {showPasswordForm && (
                        <form onSubmit={handlePasswordSubmit} className="profile-form">
                            <div className="form-group">
                                <label>كلمة المرور الحالية</label>
                                <input
                                    type="password"
                                    name="currentPassword"
                                    value={passwordData.currentPassword}
                                    onChange={handlePasswordChange}
                                    required
                                />
                            </div>
                            <div className="form-group">
                                <label>كلمة المرور الجديدة</label>
                                <input
                                    type="password"
                                    name="newPassword"
                                    value={passwordData.newPassword}
                                    onChange={handlePasswordChange}
                                    required
                                    minLength={6}
                                />
                            </div>
                            <div className="form-group">
                                <label>تأكيد كلمة المرور الجديدة</label>
                                <input
                                    type="password"
                                    name="confirmPassword"
                                    value={passwordData.confirmPassword}
                                    onChange={handlePasswordChange}
                                    required
                                />
                            </div>
                            <div className="form-actions">
                                <button type="submit" className="save-btn" disabled={loading}>
                                    {loading ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
                                </button>
                                <button type="button" className="cancel-btn" onClick={() => setShowPasswordForm(false)}>
                                    إلغاء
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Profile;

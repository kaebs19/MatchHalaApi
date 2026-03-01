import React, { useState } from 'react';
import { login } from '../services/api';
import { useToast } from '../components/Toast';
import './Login.css';

function Login({ onLogin }) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const toast = useToast();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // استدعاء API تسجيل الدخول
            const response = await login(email, password);

            if (response.success) {
                // حفظ Token والمستخدم
                localStorage.setItem('token', response.data.token);
                localStorage.setItem('user', JSON.stringify(response.data.user));
                localStorage.setItem('isLoggedIn', 'true');

                // إظهار رسالة نجاح
                toast.success('تم تسجيل الدخول بنجاح!');

                // إخبار App بتسجيل الدخول
                setTimeout(() => {
                    onLogin(response.data.user);
                }, 500);
            }
        } catch (err) {
            console.error('خطأ في تسجيل الدخول:', err);
            const errorMsg = err.response?.data?.message ||
                'حدث خطأ، تأكد من البريد الإلكتروني وكلمة المرور';
            setError(errorMsg);
            toast.error(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <div className="logo">
                    <img src="/favicon.svg" alt="شات هلا" className="logo-image" />
                    <h1>شات هلا</h1>
                    <p>لوحة التحكم</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>البريد الإلكتروني</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="admin@halachat.com"
                            required
                            dir="ltr"
                        />
                    </div>

                    <div className="form-group">
                        <label>كلمة المرور</label>
                        <div className="password-input-wrapper">
                            <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••"
                                required
                                dir="ltr"
                            />
                            <button
                                type="button"
                                className="password-toggle-btn"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex={-1}
                            >
                                {showPassword ? '🙈' : '👁️'}
                            </button>
                        </div>
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" disabled={loading}>
                        {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
                    </button>
                </form>

            </div>
        </div>
    );
}

export default Login;

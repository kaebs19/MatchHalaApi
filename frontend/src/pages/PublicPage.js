import React, { useState, useEffect } from 'react';
import { getPrivacyPolicy, getTerms, getAbout } from '../services/api';
import LoadingSpinner from '../components/LoadingSpinner';
import { formatDateLong } from '../utils/formatters';
import './PublicPage.css';

function PublicPage({ type }) {
    const [loading, setLoading] = useState(true);
    const [content, setContent] = useState('');
    const [title, setTitle] = useState('');
    const [lastUpdated, setLastUpdated] = useState(null);

    useEffect(() => {
        fetchContent();
    }, [type]);

    const fetchContent = async () => {
        try {
            setLoading(true);
            let response;

            switch (type) {
                case 'privacy':
                    response = await getPrivacyPolicy();
                    setTitle('📜 سياسة الخصوصية');
                    break;
                case 'terms':
                    response = await getTerms();
                    setTitle('📋 شروط الاستخدام');
                    break;
                case 'about':
                    response = await getAbout();
                    setTitle('ℹ️ حول التطبيق');
                    break;
                default:
                    setContent('صفحة غير موجودة');
                    setLoading(false);
                    return;
            }

            if (response.success) {
                setContent(response.data.content);
                setLastUpdated(response.data.lastUpdated);
            }
        } catch (err) {
            console.error('خطأ في جلب المحتوى:', err);
            setContent('فشل تحميل المحتوى');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <LoadingSpinner text="جاري تحميل المحتوى..." />;
    }

    return (
        <div className="public-page">
            <div className="public-page-header">
                <h1>{title}</h1>
                {lastUpdated && (
                    <p className="last-updated">
                        آخر تحديث: {formatDateLong(lastUpdated)}
                    </p>
                )}
            </div>

            <div className="public-page-content">
                <div className="markdown-content">
                    {content.split('\n').map((line, index) => {
                        // عرض Markdown بسيط
                        if (line.startsWith('# ')) {
                            return <h1 key={index}>{line.replace('# ', '')}</h1>;
                        } else if (line.startsWith('## ')) {
                            return <h2 key={index}>{line.replace('## ', '')}</h2>;
                        } else if (line.startsWith('### ')) {
                            return <h3 key={index}>{line.replace('### ', '')}</h3>;
                        } else if (line.startsWith('- ')) {
                            return <li key={index}>{line.replace('- ', '')}</li>;
                        } else if (line.trim() === '') {
                            return <br key={index} />;
                        } else {
                            return <p key={index}>{line}</p>;
                        }
                    })}
                </div>
            </div>

            <div className="public-page-footer">
                <p>© 2026 MatchHala. جميع الحقوق محفوظة.</p>
            </div>
        </div>
    );
}

export default PublicPage;

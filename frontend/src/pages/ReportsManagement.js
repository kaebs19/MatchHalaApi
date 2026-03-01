import React, { useState, useEffect } from 'react';
import Reports from './Reports';
import FlaggedMessages from './FlaggedMessages';
import PageTabs from '../components/PageTabs';

const TABS = [
    { id: 'reports', label: 'البلاغات', icon: '⚠️' },
    { id: 'flagged', label: 'الرسائل المُبلّغة', icon: '🚨' }
];

function ReportsManagement({ initialTab = 'reports', onViewUserDetail, onViewConversation }) {
    const [activeTab, setActiveTab] = useState(initialTab);

    useEffect(() => {
        setActiveTab(initialTab);
    }, [initialTab]);

    return (
        <div>
            <PageTabs
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
            />
            <div className="page-tab-content">
                {activeTab === 'reports' && <Reports onViewUserDetail={onViewUserDetail} onViewConversation={onViewConversation} />}
                {activeTab === 'flagged' && <FlaggedMessages />}
            </div>
        </div>
    );
}

export default ReportsManagement;

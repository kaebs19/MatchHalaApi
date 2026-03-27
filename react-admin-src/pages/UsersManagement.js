import React, { useState, useEffect } from 'react';
import Users from './Users';
import PremiumUsers from './PremiumUsers';
import PageTabs from '../components/PageTabs';

const TABS = [
    { id: 'users', label: 'المستخدمين', icon: '👥' },
    { id: 'premium', label: 'المميزين', icon: '👑' }
];

function UsersManagement({ onViewDetail, initialTab = 'users' }) {
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
                {activeTab === 'users' && <Users onViewDetail={onViewDetail} />}
                {activeTab === 'premium' && <PremiumUsers />}
            </div>
        </div>
    );
}

export default UsersManagement;

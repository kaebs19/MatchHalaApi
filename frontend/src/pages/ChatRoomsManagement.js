import React, { useState, useEffect } from 'react';
import ChatRooms from './ChatRooms';
import Categories from './Categories';
import PageTabs from '../components/PageTabs';

const TABS = [
    { id: 'rooms', label: 'الغرف', icon: '🏠' },
    { id: 'categories', label: 'التصنيفات', icon: '📁' }
];

function ChatRoomsManagement({ initialTab = 'rooms' }) {
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
                {activeTab === 'rooms' && <ChatRooms />}
                {activeTab === 'categories' && <Categories />}
            </div>
        </div>
    );
}

export default ChatRoomsManagement;

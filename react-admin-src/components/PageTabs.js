import React from 'react';
import './PageTabs.css';

function PageTabs({ tabs, activeTab, onTabChange }) {
    return (
        <div className="page-tabs">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    className={`page-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => onTabChange(tab.id)}
                >
                    <span className="page-tab-icon">{tab.icon}</span>
                    <span>{tab.label}</span>
                </button>
            ))}
        </div>
    );
}

export default PageTabs;

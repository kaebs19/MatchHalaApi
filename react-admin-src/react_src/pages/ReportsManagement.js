import React from 'react';
import Reports from './Reports';

function ReportsManagement({ onViewUserDetail, onViewConversation }) {
    return (
        <div>
            <Reports onViewUserDetail={onViewUserDetail} onViewConversation={onViewConversation} />
        </div>
    );
}

export default ReportsManagement;

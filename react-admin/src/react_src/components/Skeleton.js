import React from 'react';
import './Skeleton.css';

function Skeleton({ type = 'text', count = 1, height, width, className = '' }) {
    const skeletons = Array(count).fill(0);

    const getSkeletonClass = () => {
        switch (type) {
            case 'text':
                return 'skeleton-text';
            case 'title':
                return 'skeleton-title';
            case 'avatar':
                return 'skeleton-avatar';
            case 'card':
                return 'skeleton-card';
            case 'button':
                return 'skeleton-button';
            default:
                return 'skeleton-text';
        }
    };

    const style = {
        ...(height && { height }),
        ...(width && { width })
    };

    return (
        <>
            {skeletons.map((_, index) => (
                <div
                    key={index}
                    className={`skeleton ${getSkeletonClass()} ${className}`}
                    style={style}
                />
            ))}
        </>
    );
}

// مكون جاهز لصف جدول
export function TableRowSkeleton({ columns = 5 }) {
    return (
        <tr className="skeleton-row">
            {Array(columns).fill(0).map((_, index) => (
                <td key={index}>
                    <Skeleton type="text" />
                </td>
            ))}
        </tr>
    );
}

// مكون جاهز لبطاقة
export function CardSkeleton() {
    return (
        <div className="skeleton-card-wrapper">
            <Skeleton type="title" />
            <Skeleton type="text" count={3} />
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <Skeleton type="button" />
                <Skeleton type="button" />
            </div>
        </div>
    );
}

// مكون جاهز لعنصر مستخدم
export function UserItemSkeleton() {
    return (
        <div className="skeleton-user-item">
            <Skeleton type="avatar" />
            <div style={{ flex: 1 }}>
                <Skeleton type="title" width="60%" />
                <Skeleton type="text" width="80%" />
            </div>
        </div>
    );
}

export default Skeleton;

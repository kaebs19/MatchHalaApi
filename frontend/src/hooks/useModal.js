import { useState, useCallback } from 'react';

/**
 * Custom hook for modal state management
 * Replaces 4+ identical modal patterns across pages
 *
 * @returns {{ isOpen, data, open, close }}
 */
export function useModal() {
    const [isOpen, setIsOpen] = useState(false);
    const [data, setData] = useState(null);

    const open = useCallback((modalData = null) => {
        setData(modalData);
        setIsOpen(true);
    }, []);

    const close = useCallback(() => {
        setIsOpen(false);
        setData(null);
    }, []);

    return {
        isOpen,
        data,
        open,
        close
    };
}

export default useModal;

'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface BulkSelectContextValue {
  selectedIds: Set<number>;
  toggleId: (id: number) => void;
  selectAll: (ids: number[]) => void;
  clearSelection: () => void;
  isSelected: (id: number) => boolean;
}

const BulkSelectContext = createContext<BulkSelectContextValue | null>(null);

export function useBulkSelect() {
  const ctx = useContext(BulkSelectContext);
  if (!ctx) throw new Error('useBulkSelect must be used within BulkSelectProvider');
  return ctx;
}

export function BulkSelectProvider({ children }: { children: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleId = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: number[]) => {
    setSelectedIds((prev) => {
      const allSelected = ids.every((id) => prev.has(id));
      if (allSelected) {
        // Deselect all
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      } else {
        // Select all
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      }
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: number) => selectedIds.has(id),
    [selectedIds],
  );

  return (
    <BulkSelectContext.Provider
      value={{ selectedIds, toggleId, selectAll, clearSelection, isSelected }}
    >
      {children}
    </BulkSelectContext.Provider>
  );
}

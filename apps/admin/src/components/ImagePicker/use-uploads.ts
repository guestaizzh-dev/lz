import { useCallback, useState } from 'react';
export function useUploads() {
  const [items, setItems] = useState<Record<string, boolean>>({});
  const track = useCallback((key: string, busy: boolean) => setItems(current => current[key] === busy ? current : { ...current, [key]: busy }), []);
  return { uploading: Object.values(items).some(Boolean), track };
}

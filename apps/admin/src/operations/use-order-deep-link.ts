import { useLocation } from '@umijs/max';
import { useEffect, useRef } from 'react';

// Finance and recovery pages point to the same existing order workflow.
export default function useOrderDeepLink(open: (id: string) => void | Promise<void>) {
  const { search } = useLocation();
  const latest = useRef(open); latest.current = open;
  const id = new URLSearchParams(search).get('orderId');
  useEffect(() => { if (id) void latest.current(id); }, [id]);
}

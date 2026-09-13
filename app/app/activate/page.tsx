'use client';
import { useEffect } from 'react';
import { getAccountStatus } from '@/lib/account/client';
export default function ActivatePage() {
  useEffect(() => {
    void getAccountStatus().then((s) =>
      window.location.replace(
        !s.user ? '/login' : s.user.role === 'admin' ? '/admin' : '/',
      ),
    );
  }, []);
  return <output>正在跳转…</output>;
}

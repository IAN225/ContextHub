'use client';
import { useLayoutEffect, useState } from 'react';
import { createRequestScope } from './request-scope.ts';
export function useViewScope(key: string) {
  const [scope] = useState(createRequestScope);
  useLayoutEffect(() => {
    scope.invalidate();
    return () => scope.invalidate();
  }, [scope, key]);
  return scope.capture;
}

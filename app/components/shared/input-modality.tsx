'use client';
import { useEffect } from 'react';

/** Text fields match :focus-visible even after a click. Track navigation intent. */
export function InputModality() {
  useEffect(() => {
    const root = document.documentElement;
    const pointer = (event: PointerEvent) => {
      root.dataset.inputMode = 'pointer';
      root.dataset.pointerType = event.pointerType;
    };
    const keyboard = (event: KeyboardEvent) => {
      // Arrow keys continue a pointer-selected timeline gesture. Its selected
      // tick already marks the position; Tab still opts into visible focus.
      if (
        event.key.startsWith('Arrow') &&
        root.dataset.inputMode === 'pointer' &&
        event.target instanceof Element &&
        event.target.closest('.timeline')
      )
        return;
      if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
        root.dataset.inputMode = 'keyboard';
      }
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', keyboard, true);
      delete root.dataset.inputMode;
      delete root.dataset.pointerType;
    };
  }, []);
  return null;
}

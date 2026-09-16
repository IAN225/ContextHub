'use client';
import { type ReactNode } from 'react';

export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`button ${primary ? 'primary' : ''} ${className}`}
    >
      {children}
    </button>
  );
}

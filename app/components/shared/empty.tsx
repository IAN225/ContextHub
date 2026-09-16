'use client';
import { MessageSquare } from 'lucide-react';
import { type ReactNode } from 'react';

export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <MessageSquare size={32} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}

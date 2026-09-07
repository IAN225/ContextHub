import type { Metadata } from 'next';
import { InputModality } from '@/components/hub/input-modality';
import './globals.css';
import './journal.css';

export const metadata: Metadata = {
  title: 'Context Hub · 让对话自然继续',
  description: 'Context Hub 本地交互原型：原文、摘要、笔记与跨窗口记忆包。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <InputModality />
        {children}
      </body>
    </html>
  );
}

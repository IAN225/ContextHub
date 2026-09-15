'use client';
import {
  ArrowLeft,
  ChevronRight,
  ListTodo,
  Database,
  Search,
  Plus,
} from 'lucide-react';
import { AdminLink } from './admin-link';
type Props = {
  workspaceName: string;
  chapter: string;
  persistence: { error: string; saved: boolean };
  onHome: () => void;
  onTasks: () => void;
  onData: () => void;
  onSearch: () => void;
  onImport: () => void;
};
export function ReaderHeader({
  workspaceName,
  chapter,
  persistence,
  onHome,
  onTasks,
  onData,
  onSearch,
  onImport,
}: Props) {
  return (
    <header className="journal-reader-header">
      <button
        className="back-to-shelf"
        aria-label="返回工作区"
        onClick={onHome}
      >
        <ArrowLeft size={16} />
        <span>我的工作区</span>
      </button>
      <div className="reader-breadcrumb">
        <span title={workspaceName}>{workspaceName}</span>
        <ChevronRight size={13} />
        <span>{chapter}</span>
      </div>
      <div className="reader-actions">
        <AdminLink saved={persistence.saved && !persistence.error} />
        <button className="icon-button" aria-label="后台任务" onClick={onTasks}>
          <ListTodo size={17} />
        </button>
        <button className="icon-button" aria-label="数据管理" onClick={onData}>
          <Database size={17} />
        </button>
        <span className="save-state">
          <span className={`status-dot ${persistence.error ? 'error' : ''}`} />
          {persistence.error
            ? '保存失败'
            : persistence.saved
              ? '已收好'
              : '保存中…'}
        </span>
        <button
          className="icon-button"
          aria-label="搜索记忆"
          onClick={onSearch}
        >
          <Search size={17} />
        </button>
        <button
          type="button"
          className="button reader-import"
          aria-label="收录对话"
          title="收录对话"
          onClick={onImport}
        >
          <Plus size={14} />
          <span>收录对话</span>
        </button>
      </div>
    </header>
  );
}

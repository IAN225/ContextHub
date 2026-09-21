'use client';
import { CircleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
export function ImportWarning({ warning }: { warning: string }) {
  const [opened, setOpened] = useState(0);
  const id = useId();
  useEffect(() => {
    if (!opened) return;
    const timer = setTimeout(() => setOpened(0), 5000);
    return () => clearTimeout(timer);
  }, [opened]);
  return (
    <>
      <button
        className="icon-button inbox-warning-button"
        aria-label="查看导入提示"
        aria-expanded={Boolean(opened)}
        aria-controls={id}
        onClick={() => setOpened(Date.now())}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpened(0);
        }}
      >
        <CircleAlert size={16} />
      </button>
      {Boolean(opened) && (
        <output id={id} className="inbox-warning-popover">
          {warning}
        </output>
      )}
    </>
  );
}

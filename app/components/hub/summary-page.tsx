'use client';
import { SummaryEnginePage } from './summary';
import { Button } from './shared';
import {
  summaryWorkspace,
  summaryEngines,
  engineLabels,
} from '@/lib/summary/engines';
export function SummaryPage(props: Parameters<typeof SummaryEnginePage>[0]) {
  const { w, onCommand, onCommit } = props;
  const engine = w.summaryTab ?? 'custom';
  const scope = summaryWorkspace(w, engine);
  return (
    <>
      <div
        className="summary-engine-tabs"
        role="tablist"
        aria-label="摘要压缩方案"
      >
        {summaryEngines.map((value) => (
          <button
            key={value}
            id={'summary-tab-' + value}
            role="tab"
            type="button"
            aria-selected={engine === value}
            aria-controls="summary-engine-panel"
            onClick={() => onCommand({ type: 'summary/tab', value })}
            onKeyDown={(event) => {
              if (
                ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              ) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 'custom'
                    : event.key === 'End'
                      ? 'reme'
                      : engine === 'custom'
                        ? 'reme'
                        : 'custom';
                onCommand({ type: 'summary/tab', value: next });
                document.getElementById('summary-tab-' + next)?.focus();
              }
            }}
            tabIndex={engine === value ? 0 : -1}
          >
            {engineLabels[value]}
          </button>
        ))}
      </div>
      <div className="summary-engine-context">
        <p>
          {engine === 'reme'
            ? '结构化记忆检查点 · 参考 ReMeLight 的独立实现，未运行官方引擎。'
            : '原有分批压缩与自定义提示词。'}
        </p>
        {(w.memoryEngine ?? 'custom') === engine ? (
          <span className="pill">当前记忆注入来源</span>
        ) : (
          <Button
            onClick={() => onCommand({ type: 'memory/engine', value: engine })}
          >
            设为记忆注入来源
          </Button>
        )}
      </div>
      <section
        id="summary-engine-panel"
        role="tabpanel"
        aria-labelledby={'summary-tab-' + engine}
      >
        <SummaryEnginePage
          {...props}
          key={w.id + '-' + engine}
          w={scope}
          onCommand={(command) => onCommand({ ...command, engine })}
          onCommit={(command, entry) => onCommit({ ...command, engine }, entry)}
        />
      </section>
    </>
  );
}

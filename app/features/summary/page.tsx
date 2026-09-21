'use client';
import {
  engineLabels,
  summaryEngines,
  summaryWorkspace,
} from '../../lib/summary/engines.ts';
import { ClientSummaryPage } from './client-page.tsx';
import { SummaryEnginePage } from './engine-page.tsx';
export function SummaryPage(props: Parameters<typeof SummaryEnginePage>[0]) {
  const { w, onCommand, onCommit } = props;
  const engine = w.summaryTab ?? 'custom';
  const scope = summaryWorkspace(w, engine);
  return (
    <>
      <div
        className="summary-engine-tabs"
        data-scroll-rail="always"
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
                const index = summaryEngines.indexOf(engine);
                const next =
                  summaryEngines[
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? summaryEngines.length - 1
                        : (index +
                            (event.key === 'ArrowRight' ? 1 : -1) +
                            summaryEngines.length) %
                          summaryEngines.length
                  ];
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
      <section
        id="summary-engine-panel"
        role="tabpanel"
        aria-labelledby={'summary-tab-' + engine}
      >
        {engine === 'client' ? (
          <ClientSummaryPage
            key={w.id + '-client'}
            w={scope}
            onCommand={(command) => onCommand({ ...command, engine })}
          />
        ) : (
          <SummaryEnginePage
            {...props}
            key={w.id + '-' + engine}
            w={scope}
            onCommand={(command) => onCommand({ ...command, engine })}
            onCommit={(command, entry) =>
              onCommit({ ...command, engine }, entry)
            }
          />
        )}
      </section>
    </>
  );
}

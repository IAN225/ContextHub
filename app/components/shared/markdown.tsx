'use client';

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {text.split(/(```[\s\S]*?```)/g).map((section, sectionIndex) =>
        section.startsWith('```') ? (
          <pre key={sectionIndex}>
            {section.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}
          </pre>
        ) : (
          <div key={sectionIndex}>
            {section.split('\n').map((line, i) => {
              if (!line) return <div className="paragraph-space" key={i} />;
              const heading = line.match(/^(#{1,3})\s+(.*)/);
              const parts = (heading ? heading[2] : line.replace(/^[-*] /, ''))
                .split(/(\*\*.*?\*\*)/)
                .map((p, j) =>
                  p.startsWith('**') ? (
                    <strong key={j}>{p.slice(2, -2)}</strong>
                  ) : (
                    p
                  ),
                );
              return heading ? (
                <h3 key={i}>{parts}</h3>
              ) : (
                <p className={/^[-*] /.test(line) ? 'list-line' : ''} key={i}>
                  {parts}
                </p>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
}

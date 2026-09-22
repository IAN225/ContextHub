export function TurnDivider({ number }: { number: number }) {
  return (
    <div className="turn-divider" aria-label={`第 ${number} 轮`}>
      <span className="turn-marker" aria-hidden="true">
        <span className="turn-flank">{'<·'}</span>
        <svg className="turn-dial" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="7.5" />
          {Array.from({ length: 12 }, (_, index) => (
            <path
              key={index}
              d="M12 2v2"
              transform={`rotate(${index * 30} 12 12)`}
            />
          ))}
          <path d="M12 7v5l3 2" />
          <circle className="turn-dial-pin" cx="12" cy="12" r=".8" />
        </svg>
        <span className="turn-marker-number">{number}</span>
        <span className="turn-flank">{'·>'}</span>
      </span>
    </div>
  );
}

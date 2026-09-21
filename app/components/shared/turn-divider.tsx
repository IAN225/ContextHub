export function TurnDivider({ number }: { number: number }) {
  return (
    <div className="turn-divider">
      <span aria-hidden="true">◇</span>
      <small>第 {number} 轮</small>
      <span aria-hidden="true">◇</span>
    </div>
  );
}

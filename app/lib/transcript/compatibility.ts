/** Drop the retired per-turn title at storage and task boundaries. */
export function withoutTurnTitle<T extends object>(turn: T): Omit<T, 'title'> {
  if (!Object.hasOwn(turn, 'title')) return turn;
  const { title: _title, ...rest } = turn as T & { title?: unknown };
  return rest;
}
export function normalizeTurnList<T extends object>(turns: T[]): T[] {
  return turns.some((turn) => Object.hasOwn(turn, 'title'))
    ? (turns.map(withoutTurnTitle) as T[])
    : turns;
}

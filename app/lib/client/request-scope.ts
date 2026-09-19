// A response belongs to the exact view/lifetime that started it, even after A -> B -> A.
export function createRequestScope() {
  let revision = 0;
  return {
    invalidate(this: void) {
      ++revision;
    },
    capture(this: void) {
      const current = revision;
      return () => current === revision;
    },
  };
}

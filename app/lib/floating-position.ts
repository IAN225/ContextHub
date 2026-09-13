export type FloatingPoint = { x: number; y: number };
export type FloatingViewport = {
  width: number;
  height: number;
  left?: number;
  top?: number;
};
export const PET_SIZE = 64;
export function fitPetPosition(
  point: FloatingPoint,
  viewport: FloatingViewport,
): FloatingPoint {
  const fit = (value: number, start: number, extent: number) => {
    const margin = Math.min(12, Math.max(0, (extent - PET_SIZE) / 2));
    return Math.max(
      start + margin,
      Math.min(start + Math.max(margin, extent - PET_SIZE - margin), value),
    );
  };
  return {
    x: fit(point.x, viewport.left ?? 0, viewport.width),
    y: fit(point.y, viewport.top ?? 0, viewport.height),
  };
}

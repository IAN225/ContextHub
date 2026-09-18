'use client';
/* oxlint-disable nextjs/no-img-element -- Frame sources are local package assets; no image optimizer is involved. */
import { useEffect, useState } from 'react';
import { builtinPet } from '../../lib/pets/builtin.ts';
import {
  frameIndex,
  petAnimation,
  type PetPack,
  type PetState,
} from '../../lib/pets/contracts.ts';
export function PetFramePlayer({
  pack,
  state,
  className = '',
}: {
  pack: PetPack;
  state: PetState;
  className?: string;
}) {
  const animation = petAnimation(pack, state);
  const [position, setPosition] = useState({ animation, index: 0 }),
    [failure, setFailure] = useState<typeof animation | null>(null);
  useEffect(() => {
    let raf = 0,
      stopped = false,
      start = 0;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const images = animation.frames.map((frame) => {
      const img = new Image();
      img.src = frame.src;
      return img;
    });
    function tick(at: number) {
      if (stopped) return;
      const next = frameIndex(animation, at - start);
      setPosition((old) =>
        old.animation === animation && old.index === next
          ? old
          : { animation, index: next },
      );
      if (animation.loop || next < animation.frames.length - 1)
        raf = requestAnimationFrame(tick);
    }
    function resume() {
      cancelAnimationFrame(raf);
      setPosition({ animation, index: 0 });
      start = performance.now();
      if (!document.hidden && !motion.matches && animation.frames.length > 1)
        raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(resume);
    document.addEventListener('visibilitychange', resume);
    motion.addEventListener('change', resume);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', resume);
      motion.removeEventListener('change', resume);
      images.length = 0;
    };
  }, [animation]);
  if (failure === animation && pack !== builtinPet)
    return (
      <PetFramePlayer pack={builtinPet} state={state} className={className} />
    );
  const frame =
    animation.frames[
      position.animation === animation
        ? Math.min(position.index, animation.frames.length - 1)
        : 0
    ];
  return (
    <img
      className={'pet-animation ' + className}
      src={frame.src}
      width={frame.width}
      height={frame.height}
      alt=""
      aria-hidden="true"
      draggable={false}
      onError={() => setFailure(animation)}
    />
  );
}

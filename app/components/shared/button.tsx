'use client';
import type { ComponentProps } from 'react';
import { Button as BaseButton } from '../ui/button';

type Props = Omit<
  ComponentProps<typeof BaseButton>,
  'variant' | 'size' | 'unstyled' | 'className'
> & {
  primary?: boolean;
  className?: string;
};
// Keep the workspace appearance while sharing native semantics, refs and render composition.
export function Button({
  primary = false,
  className = '',
  type = 'button',
  ...props
}: Props) {
  return (
    <BaseButton
      {...props}
      type={type}
      unstyled
      className={'button ' + (primary ? 'primary ' : '') + className}
    />
  );
}

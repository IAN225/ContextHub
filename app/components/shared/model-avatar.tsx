import { Bot, MessageCircle, Orbit, Sparkles } from 'lucide-react';
import type { WorkspaceAppearance } from '../../lib/workspaces/appearance.ts';
export function ModelAvatar({
  value,
}: {
  value?: WorkspaceAppearance['avatar'];
}) {
  const Icon =
    value === 'bot'
      ? Bot
      : value === 'message'
        ? MessageCircle
        : value === 'orbit'
          ? Orbit
          : Sparkles;
  return <Icon size={20} aria-hidden="true" />;
}

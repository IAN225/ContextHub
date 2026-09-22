import type { Message } from '../core/model.ts';

export function isToolMessage(role: string) {
  return (
    role === 'tool' ||
    role === 'tool_call' ||
    role === 'tool_use' ||
    role === 'tool_result'
  );
}

/** Display grouping only: preserve message order, indexes, and attachment ownership. */
export function conversationGroups(messages: readonly Message[]) {
  const groups: { role: string; indices: number[] }[] = [];
  messages.forEach((message, index) => {
    const role = isToolMessage(message.role) ? 'assistant' : message.role;
    const previous = groups.at(-1);
    if (role === 'assistant' && previous?.role === 'assistant') {
      previous.indices.push(index);
    } else {
      groups.push({ role, indices: [index] });
    }
  });
  return groups;
}

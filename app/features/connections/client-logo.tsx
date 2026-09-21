import Image from 'next/image';
import { Plug } from 'lucide-react';

// OpenAI mark: https://openai.com/brand/ (OpenAI-Logos-2025.zip).
// The mark belongs to OpenAI; used only to identify the connected client.
// Claude's radial mark is drawn as paths so mobile fonts cannot replace it.
export function ClientLogo({ client }: { client: string }) {
  if (client === 'chatgpt')
    return (
      <Image
        src="/clients/openai.png"
        width={24}
        height={24}
        alt=""
        unoptimized
      />
    );
  if (client === 'claude')
    return (
      <svg
        width="24"
        height="24"
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <g stroke="#C15F3C" strokeWidth="3.5" strokeLinecap="round">
          <path d="M24 23 22 4M25 23 33 6M25 24 44 17M25 25 44 28M24 25 35 42M23 25 21 45M22 25 8 39M22 24 3 27M22 23 6 15M23 22 12 6" />
          <path d="m24 24 17 13M24 24 13 29" strokeWidth="2.5" />
        </g>
      </svg>
    );
  return <Plug size={20} aria-hidden="true" />;
}

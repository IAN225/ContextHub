'use client';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function Segments({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Tabs
      className="segments-root"
      value={value}
      onValueChange={(v) => onChange(String(v))}
    >
      <TabsList variant="line" className="segments" data-scroll-rail="always">
        {options.map((o) => (
          <TabsTrigger key={o.id} value={o.id}>
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

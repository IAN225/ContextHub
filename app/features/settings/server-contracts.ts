export type Access = {
  origin: string;
  mode: 'automatic' | 'external';
  expiresAt: string | null;
  issuer: string | null;
  checkedAt: string | null;
};
export type ServerStatus = {
  enabled: boolean;
  initialized?: boolean;
  authenticated?: boolean;
  localSetup?: boolean;
  access?: Access | null;
  pending?: { origin: string; phase: string } | null;
  error?: string;
};

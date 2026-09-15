import { workspaceTones } from './workspace-appearance.ts';
export type WorkspaceTone = keyof typeof workspaceTones;
export function workspaceThemeClass(tone?: WorkspaceTone) {
  return tone ? 'workspace-theme tone-' + tone : '';
}
// Accents are limited to interaction; reading surfaces and ink stay nearly neutral.
export const workspacePalette = {
  sage: {
    accent: '#50683e',
    hover: '#3f5530',
    soft: '#eef2e9',
    borderAccent: '#9fae92',
    canvas: '#f2f1ed',
    surface: '#fffefa',
    subtle: '#f5f5f0',
    text: '#3f423b',
    heading: '#2f352a',
    muted: '#62685b',
    border: '#d9dcd2',
  },
  blue: {
    accent: '#34647e',
    hover: '#244d64',
    soft: '#eaf1f5',
    borderAccent: '#97afbe',
    canvas: '#f0f1f2',
    surface: '#fdfdfb',
    subtle: '#f3f5f5',
    text: '#394249',
    heading: '#2c353c',
    muted: '#5e6971',
    border: '#d6dde0',
  },
  rose: {
    accent: '#885264',
    hover: '#703e4f',
    soft: '#f6edf0',
    borderAccent: '#c1a0ac',
    canvas: '#f3f0ee',
    surface: '#fffdfa',
    subtle: '#f7f3f2',
    text: '#473e41',
    heading: '#3c2e32',
    muted: '#716169',
    border: '#e1d7d9',
  },
  sand: {
    accent: '#7a6035',
    hover: '#604a26',
    soft: '#f4eee3',
    borderAccent: '#bca888',
    canvas: '#f3f0e9',
    surface: '#fffdf8',
    subtle: '#f7f4ed',
    text: '#454138',
    heading: '#373127',
    muted: '#6b6457',
    border: '#dfd9cd',
  },
} as const;

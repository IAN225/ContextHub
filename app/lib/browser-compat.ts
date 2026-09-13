import { sha256 } from '@noble/hashes/sha2.js';

// Digest and Clipboard APIs require a secure context; plain HTTP does not provide one.
export function sha256Hex(bytes: Uint8Array) {
  return Array.from(sha256(bytes), (v) => v.toString(16).padStart(2, '0')).join(
    '',
  );
}
export function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}
export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const previous = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.style.cssText =
    'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  document.body.appendChild(field);
  field.focus();
  field.select();
  try {
    // oxlint-disable-next-line typescript/no-deprecated -- Plain HTTP has no Clipboard API; retain user-gesture copy support.
    if (!document.execCommand('copy'))
      throw new Error('复制失败，请手动选择。');
  } finally {
    field.remove();
    if (previous instanceof HTMLElement)
      previous.focus({ preventScroll: true });
  }
}

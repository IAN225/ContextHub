// Provider-independent, conservative estimate. This is not a model tokenizer;
// UTF-8 bytes bound the text contribution without trusting request-wide usage.
const encoder = new TextEncoder();
export function estimateTextTokens(text: string) {
  return encoder.encode(text).length;
}

/** Keep backend classifications in diagnostics, with plain recovery text in controls. */
export function readableError(message: string): string {
  return message.replace(/^(?:\[[A-Z_]+(?: [^\]]+)?\]\s*)+/, '');
}

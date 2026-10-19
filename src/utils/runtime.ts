/**
 * Small runtime helpers that keep impure calls out of component bodies.
 */
export function nowMs(): number {
  return Date.now();
}

export function shuffledCopy<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

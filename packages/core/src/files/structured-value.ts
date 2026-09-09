export interface StructuredValueLimits {
  readonly maximumNodes: number;
  readonly maximumDepth: number;
  readonly maximumCollectionEntries: number;
}

interface StackEntry {
  readonly value: unknown;
  readonly depth: number;
  readonly leaving: boolean;
}

export function structuredValueLimitViolation(
  root: unknown,
  limits: StructuredValueLimits,
): string | undefined {
  const active = new WeakSet<object>();
  const stack: StackEntry[] = [{ value: root, depth: 0, leaving: false }];
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.value === null || typeof current.value !== "object") {
      nodes += 1;
      if (nodes > limits.maximumNodes) {
        return `Structured input exceeds the ${limits.maximumNodes}-node limit.`;
      }
      continue;
    }
    if (current.leaving) {
      active.delete(current.value);
      continue;
    }

    nodes += 1;
    if (nodes > limits.maximumNodes) {
      return `Structured input exceeds the ${limits.maximumNodes}-node limit.`;
    }
    if (current.depth > limits.maximumDepth) {
      return `Structured input exceeds the ${limits.maximumDepth}-level depth limit.`;
    }
    if (active.has(current.value)) return "Structured input contains a cyclic alias.";
    active.add(current.value);
    stack.push({ ...current, leaving: true });

    const values = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    if (values.length > limits.maximumCollectionEntries) {
      return `A structured collection exceeds the ${limits.maximumCollectionEntries}-entry limit.`;
    }
    for (const value of values) {
      stack.push({ value, depth: current.depth + 1, leaving: false });
    }
  }

  return undefined;
}

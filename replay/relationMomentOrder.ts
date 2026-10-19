/**
 * The Replay order of one stage's relation moments. Moments follow authored
 * order, except that a relation needing syntax that a later relation of its
 * stage introduces plays right after that relation's moment (after the last of
 * them when it needs several). Relations deferred to the same moment keep their
 * authored order, so do all relations that need nothing later, and a chain of
 * such needs resolves in turn.
 *
 * `dependencies` maps a relation index to the relations whose moments introduce
 * syntax it needs. Needs that form a cycle cannot all be met: the relations of
 * one cycle keep their authored order among themselves, each still waiting for
 * its needs outside the cycle. A cycle member's moment may lack syntax it
 * introduces, so a relation needing that member keeps its authored position
 * relative to it as well. The scheduler reports the syntax these relations
 * lack as RELATION_TIMING_CONFLICT.
 */
export const orderRelationMoments = (
  relationIndexes: readonly number[],
  dependencies: ReadonlyMap<number, ReadonlySet<number>>
): number[] => {
  const authored = [...new Set(relationIndexes)].sort((left, right) => left - right);
  const known = new Set(authored);
  const needs = new Map(authored.map(index => [index,
    [...(dependencies.get(index) ?? [])].filter(other => other !== index && known.has(other))]));
  // Tarjan's strongly connected components, visited in authored order.
  const component = new Map<number, number>(), low = new Map<number, number>(), visit = new Map<number, number>();
  const stack: number[] = [], onStack = new Set<number>();
  let counter = 0;
  const connect = (index: number) => {
    visit.set(index, counter);
    low.set(index, counter++);
    stack.push(index);
    onStack.add(index);
    needs.get(index)!.forEach(other => {
      if (!visit.has(other)) {
        connect(other);
        low.set(index, Math.min(low.get(index)!, low.get(other)!));
      } else if (onStack.has(other))
        low.set(index, Math.min(low.get(index)!, visit.get(other)!));
    });
    if (low.get(index) !== visit.get(index))
      return;
    for (let member = stack.pop()!; ; member = stack.pop()!) {
      onStack.delete(member);
      component.set(member, index);
      if (member === index)
        break;
    }
  };
  authored.forEach(index => { if (!visit.has(index)) connect(index); });
  const together = (left: number, right: number) => component.get(left) === component.get(right);
  const cyclic = new Set(authored.filter(index => authored.some(other => other !== index && together(other, index))));
  const waits = new Map(authored.map(index => [index, [
    ...needs.get(index)!.filter(other => !cyclic.has(other)),
    // A member of a cycle also waits for the earlier members of that cycle.
    ...authored.filter(other => other < index && together(other, index))
  ]]));
  const order: number[] = [], played = new Set<number>();
  const ready = (index: number) => waits.get(index)!.every(other => played.has(other));
  while (order.length < authored.length) {
    const next = authored.find(index => !played.has(index) && ready(index))!;
    order.push(next);
    played.add(next);
  }
  return order;
};

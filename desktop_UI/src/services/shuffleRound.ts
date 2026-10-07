import { shuffled } from './playbackUtils';

// Keep one session's remaining songs independent of the current media/history.
// Membership changes reconcile the round instead of bringing heard songs back.
export class ShuffleRound<T> {
  private visited = new Set<T>();
  private remaining: T[] = [];

  clear(): void {
    this.visited.clear();
    this.remaining = [];
  }

  visit(items: T[], current?: T): void {
    const eligible = new Set(items);
    // Temporarily hidden/disliked songs remain heard within this round. If
    // restored before it ends, they cannot crowd out the remaining songs.
    this.remaining = this.remaining.filter(item => eligible.has(item) && !this.visited.has(item));
    const known = new Set([...this.visited, ...this.remaining]);
    this.remaining.push(...shuffled([...eligible].filter(item => !known.has(item))));
    if (current !== undefined && eligible.has(current)) {
      this.visited.add(current);
      this.remaining = this.remaining.filter(item => item !== current);
    }
  }

  next(items: T[], current?: T): T | undefined {
    this.visit(items, current);
    const eligible = [...new Set(items)];
    if (!eligible.length) return;
    if (!this.remaining.length) {
      this.visited.clear();
      this.remaining = shuffled(eligible);
      // A full new round still contains every song; avoid repeating its seam.
      if (this.remaining.length > 1 && this.remaining[0] === current) {
        [this.remaining[0], this.remaining[1]] = [this.remaining[1], this.remaining[0]];
      }
    }
    const target = this.remaining.shift();
    if (target !== undefined) this.visited.add(target);
    return target;
  }

  replace(from: T, to: T): void {
    this.visited = new Set([...this.visited].map(item => item === from ? to : item));
    this.remaining = [...new Set(this.remaining.map(item => item === from ? to : item))]
      .filter(item => !this.visited.has(item));
  }
}

import { afterEach, expect, it, vi } from 'vitest';
import { ShuffleRound } from './shuffleRound';

afterEach(() => vi.restoreAllMocks());

it('covers every member once per round and avoids an adjacent repeat at the seam', () => {
  vi.spyOn(Math, 'random').mockReturnValue(.42);
  const bag = new ShuffleRound<string>(), items = ['A', 'B', 'C', 'D'];
  let current = 'A';
  bag.visit(items, current);
  const heard = [current];
  for (let i = 1; i < items.length * 3; i++) {
    const next = bag.next(items, current)!;
    expect(next).not.toBe(current);
    heard.push(current = next);
  }
  for (let offset = 0; offset < heard.length; offset += items.length) {
    expect(new Set(heard.slice(offset, offset + items.length))).toEqual(new Set(items));
  }
});

it('manual reselection and copied or reordered membership preserve the remaining round', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  const bag = new ShuffleRound<string>(), items = ['A', 'B', 'C', 'D'];
  bag.visit(items, 'A');
  const consumed = ['A', bag.next(items, 'A')!];
  const chosen = items.find(item => !consumed.includes(item))!;
  bag.visit([...items].reverse(), chosen);
  bag.visit([...items], chosen);
  expect(random).toHaveBeenCalledTimes(items.length - 1);
  const last = bag.next(items, chosen)!;
  expect(new Set([...consumed, chosen, last])).toEqual(new Set(items));
});

it('eligibility changes remove forbidden entries and add new ones without replaying a temporarily removed heard song', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const bag = new ShuffleRound<string>();
  bag.visit(['A', 'B', 'C', 'D'], 'A');
  const first = bag.next(['B', 'C', 'D'], 'A')!;
  const eligible = ['A', ...['B', 'C', 'D'].filter(item => item === first || item === 'D'), 'E'];
  const remaining = eligible.filter(item => item !== 'A' && item !== first);
  const heard: string[] = [];
  let current = first;
  for (let i = 0; i < remaining.length; i++) heard.push(current = bag.next(eligible, current)!);
  expect(new Set(heard)).toEqual(new Set(remaining));
});

it('empty eligibility does not erase a heard identity and one eligible song can repeat safely', () => {
  const bag = new ShuffleRound<string>();
  bag.visit(['A', 'B'], 'A');
  expect(bag.next([], 'A')).toBeUndefined();
  expect(bag.next(['A', 'B'], 'A')).toBe('B');
  expect(bag.next(['B'], 'B')).toBe('B');
  expect(bag.next(['B'], 'B')).toBe('B');
});

it('renaming a heard file keeps it heard while deduplicating identity collisions', () => {
  const bag = new ShuffleRound<string>();
  bag.visit(['old', 'B', 'C'], 'old');
  bag.replace('old', 'new');
  const first = bag.next(['new', 'B', 'C'], 'new')!;
  const second = bag.next(['new', 'B', 'C'], first)!;
  expect(new Set([first, second])).toEqual(new Set(['B', 'C']));
  bag.replace(first, second);
  expect(bag.next(['new', second], second)).toBe('new');
});

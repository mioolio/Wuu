import { describe, expect, it } from 'vitest';
import { recordListening, recordPlay } from './listeningHistory';

describe('dated listening records', () => {
  it('preserves old totals without inventing their dates', () => {
    const result = recordPlay({plays:12,duration:900},new Date(2026,9,1,12));
    expect(result).toEqual({plays:13,duration:900,recentDays:{'2026-10-01':{plays:1,duration:0}}});
  });
  it('splits listening across local midnight without double counting', () => {
    const result = recordListening({plays:1,duration:10},4,new Date(2026,9,2,0,0,2));
    expect(result.duration).toBe(14);
    expect(result.recentDays).toEqual({'2026-10-01':{plays:0,duration:2},'2026-10-02':{plays:0,duration:2}});
  });
  it('retains only 90 days of detail while keeping lifetime totals', () => {
    const result = recordListening({plays:99,duration:999,recentDays:{'2026-01-01':{plays:1,duration:10},'2026-09-30':{plays:2,duration:5}}},1,new Date(2026,9,1,12));
    expect(result.duration).toBe(1000);
    expect(result.plays).toBe(99);
    expect(result.recentDays?.['2026-01-01']).toBeUndefined();
    expect(result.recentDays?.['2026-09-30']).toEqual({plays:2,duration:5});
  });
  it.each([NaN,Infinity,-1,0,100])('ignores invalid or suspended intervals (%s)', seconds => {
    const stats={plays:2,duration:15};
    expect(recordListening(stats,seconds)).toBe(stats);
  });
});

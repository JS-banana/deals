import { describe, expect, it } from 'vitest';
import { calendarDay, dealState, isEndingSoon } from './status.ts';

const base = {
  startsOn: null,
  endsOn: null,
  startsAt: null,
  endsAt: null,
  dateZone: null,
  observedLiveOn: null,
  observedEndedAt: null,
};
const at = (iso: string) => new Date(iso);

describe('calendarDay', () => {
  it('uses the requested zone', () => {
    const now = at('2026-11-30T20:00:00Z');
    expect(calendarDay(now)).toBe('2026-12-01');
    expect(calendarDay(now, 'America/Los_Angeles')).toBe('2026-11-30');
  });
});

describe('dealState', () => {
  it('prioritizes a merchant end observation over the advertised schedule', () => {
    const d = {
      ...base,
      startsOn: '2026-11-01',
      endsAt: '2026-12-04T12:00:00Z',
      endsOn: '2026-12-04',
      observedEndedAt: '2026-12-01T10:00:00Z',
    };
    expect(dealState(d, at('2026-12-01T10:00:01Z'))).toBe('ended');
    expect(isEndingSoon(d, at('2026-12-01T10:00:01Z'))).toBe(false);
  });

  it('treats a precise end instant as exclusive', () => {
    const d = { ...base, startsOn: '2026-11-19', endsAt: '2026-12-01T08:00:00Z' };
    expect(dealState(d, at('2026-12-01T07:59:59Z'))).toBe('live');
    expect(dealState(d, at('2026-12-01T08:00:00Z'))).toBe('ended');
  });

  it('keeps a date-only deal live through its last local day', () => {
    const d = {
      ...base,
      startsOn: '2026-11-20',
      endsOn: '2026-11-30',
      dateZone: 'America/Los_Angeles',
    };
    // 2026-12-01 03:00 in Shanghai is still Nov 30 in Los Angeles.
    expect(dealState(d, at('2026-11-30T19:00:00Z'))).toBe('live');
    expect(dealState(d, at('2026-12-01T08:00:01Z'))).toBe('ended');
  });

  it('reports upcoming before the start', () => {
    const d = { ...base, startsAt: '2026-11-27T00:00:00-08:00', endsOn: '2026-12-01' };
    expect(dealState(d, at('2026-11-26T12:00:00Z'))).toBe('upcoming');
    expect(dealState(d, at('2026-11-27T09:00:00Z'))).toBe('live');
  });

  it('is unknown until a start is published or observed', () => {
    const d = { ...base, endsOn: '2026-12-03' };
    expect(dealState(d, at('2026-11-20T00:00:00Z'))).toBe('unknown');
    expect(dealState({ ...d, observedLiveOn: '2026-11-19' }, at('2026-11-20T00:00:00Z'))).toBe(
      'live',
    );
    expect(dealState({ ...d, observedLiveOn: '2026-11-21' }, at('2026-11-20T00:00:00Z'))).toBe(
      'unknown',
    );
  });
});

describe('isEndingSoon', () => {
  it('flags precise ends within 48 hours', () => {
    const d = { ...base, startsOn: '2026-11-01', endsAt: '2026-12-01T08:00:00Z' };
    expect(isEndingSoon(d, at('2026-11-29T07:59:00Z'))).toBe(false);
    expect(isEndingSoon(d, at('2026-11-29T08:00:00Z'))).toBe(true);
    expect(isEndingSoon(d, at('2026-12-01T08:00:00Z'))).toBe(false);
  });

  it('flags the last two calendar days, including deals with an unknown start', () => {
    const d = { ...base, endsOn: '2026-12-03' };
    expect(isEndingSoon(d, at('2026-12-01T04:00:00Z'))).toBe(false);
    expect(isEndingSoon(d, at('2026-12-02T04:00:00Z'))).toBe(true);
    expect(isEndingSoon(d, at('2026-12-03T15:00:00Z'))).toBe(true);
    expect(isEndingSoon(d, at('2026-12-03T17:00:00Z'))).toBe(false);
  });
});

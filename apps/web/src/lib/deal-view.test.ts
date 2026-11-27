import { createFormatter, createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import zh from '../../messages/zh.json';
import { deadline, type T } from './deal-view';

const deal = {
  startsOn: '2026-11-20',
  endsOn: '2026-12-01',
  startsAt: null,
  endsAt: null,
  dateZone: null,
  observedLiveOn: null,
  observedEndedAt: null,
};

describe('deadline', () => {
  it('counts remaining merchant calendar days and displays the published date alone', () => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'deal' }) as T;
    const fmt = createFormatter({ locale: 'en', timeZone: 'UTC' });
    const due = (iso: string) => deadline(deal, new Date(iso), t, fmt);
    expect(due('2026-11-30T20:00:00Z').primary).toBe('1 day left');
    expect(due('2026-12-01T20:00:00Z')).toEqual({
      primary: 'Ends today',
      secondary: 'Dec 1',
      tone: 'urgent',
    });
    expect(due('2026-12-02T08:30:00Z').primary).toBe('Ended');
  });

  it.each([
    { locale: 'en', messages: en, timeZone: 'UTC', time: '20:00' },
    { locale: 'zh', messages: zh, timeZone: 'Asia/Shanghai', time: '04:00' },
  ])('labels precise times in the $locale display zone', ({ locale, messages, timeZone, time }) => {
    const t = createTranslator({ locale, messages, namespace: 'deal' }) as T;
    const fmt = createFormatter({ locale, timeZone });
    const instant = '2026-12-01T20:00:00Z';
    const before = new Date('2026-12-01T19:00:00Z');
    const ending = { ...deal, endsAt: instant };
    const expected = `${time} ${messages.product.zone}`;
    expect(deadline(ending, before, t, fmt).secondary).toContain(expected);
    expect(deadline(ending, new Date(instant), t, fmt).secondary).toContain(expected);
    expect(deadline({ ...deal, startsAt: instant }, before, t, fmt).secondary).toContain(expected);
  });
});

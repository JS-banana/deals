import { revalidatePath, updateTag } from 'next/cache';
import { headers } from 'next/headers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as actions from '../app/admin/actions';
import { isAdminAuthorized, requireAdmin } from './admin-auth';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const write = vi.hoisted(() => vi.fn());
vi.mock('@deals/db', async (original) => ({
  ...(await original<typeof import('@deals/db')>()),
  getDb: () => ({ update: () => ({ set: () => ({ where: write }) }) }),
}));

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString('base64')}`;

describe('admin authentication', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_USER', 'editor');
    vi.stubEnv('ADMIN_PASSWORD', '审核:secret');
    vi.mocked(headers).mockResolvedValue(new Headers());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('checks UTF-8 credentials and treats malformed headers as unauthorized', () => {
    expect(isAdminAuthorized(basic('editor:审核:secret'))).toBe('ok');
    for (const header of [
      null,
      'Bearer token',
      'Basic %',
      basic('editor'),
      basic('editor:wrong'),
    ]) {
      expect(isAdminAuthorized(header)).toBe('unauthorized');
    }
  });

  it('fails closed when a credential is missing', async () => {
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect(isAdminAuthorized(basic('editor:'))).toBe('unconfigured');
    await expect(requireAdmin()).rejects.toThrow('Unauthorized');
  });

  it('requires credentials at every mutation entry before reading the form', async () => {
    const fd = new FormData();
    for (const action of [
      actions.approveAction,
      actions.rejectAction,
      actions.resolveFlagAction,
      actions.saveDealAction,
      actions.saveEventAction,
    ]) {
      await expect(action({}, fd)).rejects.toThrow('Unauthorized');
    }
    for (const action of [
      actions.setDealRankAction,
      actions.setDealStatusAction,
      actions.featureEventAction,
    ]) {
      await expect(action(fd)).rejects.toThrow('Unauthorized');
    }
    expect(write).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('expires both public tags immediately after a successful admin write', async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({ authorization: basic('editor:审核:secret') }),
    );
    const fd = new FormData();
    fd.set('id', '1');
    fd.set('status', 'hidden');
    await actions.setDealStatusAction(fd);
    expect(write).toHaveBeenCalledOnce();
    expect(vi.mocked(updateTag).mock.calls).toEqual([['deals'], ['events']]);
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout');
  });
});

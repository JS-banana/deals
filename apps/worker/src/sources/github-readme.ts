import { parseReadme } from '../upstream.ts';
import { sha256 } from '../util.ts';
import { readSource, type SourceAdapter } from './types.ts';

export const githubReadme: SourceAdapter = async (ctx, source, cursor) => {
  const repo = source.target;
  const base = `https://github.com/${repo}`;
  let sha: string;
  try {
    sha = (
      await readSource(
        ctx,
        `https://api.github.com/repos/${repo}/commits/HEAD`,
        'application/vnd.github.sha',
        ctx.config.githubToken ? { authorization: `Bearer ${ctx.config.githubToken}` } : undefined,
      )
    ).trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('invalid GitHub revision');
  } catch {
    const feed = await readSource(ctx, `${base}/commits/HEAD.atom`, 'application/atom+xml');
    const match = /Grit::Commit\/([a-f0-9]{40})/.exec(feed)?.[1];
    if (!match) throw new Error('no GitHub revision');
    sha = match;
  }
  if (cursor === sha) return { cursor, signals: [] };
  const readme = await readSource(
    ctx,
    `https://raw.githubusercontent.com/${repo}/${sha}/README.md`,
    'text/plain',
  );
  const entries = parseReadme(readme, true).filter((entry) => entry.offer || entry.description);
  if (!entries.length) throw new Error('README format unrecognized (no offer rows)');
  return {
    cursor: sha,
    signals: entries.map((e) => ({
      signalKey: sha256(e.key),
      sourceType: 'github',
      sourceName: repo,
      sourceUrl: `${base}/blob/${sha}/README.md#L${e.line}`,
      title: e.name,
      rawText: e.raw.slice(0, 10000),
      candidateUrls: [e.url],
      publishedAt: null,
    })),
  };
};

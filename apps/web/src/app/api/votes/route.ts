import { getDb } from '@deals/db';
import { castVote, communityIdentity, readCommunityInput, voteInput } from '@/lib/community';

export async function POST(request: Request) {
  const who = communityIdentity(request.headers);
  if (!who) return Response.json({}, { status: 503 });
  const parsed = voteInput.safeParse(await readCommunityInput(request));
  if (!parsed.success) return Response.json({}, { status: 400 });
  const result = await castVote(getDb(), who, parsed.data);
  return Response.json(result.summary ?? {}, { status: result.status });
}

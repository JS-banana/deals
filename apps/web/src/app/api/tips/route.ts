import { getDb } from '@deals/db';
import { communityIdentity, readCommunityInput, submitTip, tipInput } from '@/lib/community';

export async function POST(request: Request) {
  const who = communityIdentity(request.headers);
  if (!who) return Response.json({}, { status: 503 });
  const parsed = tipInput.safeParse(await readCommunityInput(request));
  if (!parsed.success) return Response.json({}, { status: 400 });
  return Response.json({}, { status: await submitTip(getDb(), who, parsed.data) });
}

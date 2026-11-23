import { voteSummary } from '@/lib/community';
import { VoteButtons } from './vote-buttons';

export async function CommunityVotes({ dealId }: { dealId: number }) {
  return <VoteButtons key={dealId} dealId={dealId} initial={await voteSummary(dealId)} />;
}

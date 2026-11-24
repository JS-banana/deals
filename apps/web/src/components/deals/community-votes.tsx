import { voteSummary } from '@/lib/community';
import { VoteButtons } from './vote-buttons';

export async function CommunityVotes({
  dealId,
  compact = false,
}: {
  dealId: number;
  compact?: boolean;
}) {
  return (
    <VoteButtons
      key={dealId}
      dealId={dealId}
      initial={await voteSummary(dealId)}
      compact={compact}
    />
  );
}

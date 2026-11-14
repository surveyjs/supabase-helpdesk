import { IntentPrefetchLink } from '@/components/ui/IntentPrefetchLink';

export function DisplayName({
  userId,
  displayName,
  isCurrentUserAgent,
}: {
  userId: string;
  displayName: string;
  isCurrentUserAgent: boolean;
}) {
  if (isCurrentUserAgent) {
    return (
      <IntentPrefetchLink
        href={`/agent/users/${userId}`}
        className="text-blue-600 hover:text-blue-800 hover:underline"
      >
        {displayName}
      </IntentPrefetchLink>
    );
  }

  return <span>{displayName}</span>;
}

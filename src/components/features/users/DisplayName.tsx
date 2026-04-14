import Link from 'next/link';

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
      <Link
        href={`/agent/users/${userId}`}
        className="text-blue-600 hover:text-blue-800 hover:underline"
      >
        {displayName}
      </Link>
    );
  }

  return <span>{displayName}</span>;
}

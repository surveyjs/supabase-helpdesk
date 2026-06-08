import Link from 'next/link';

/**
 * Opens the create-ticket page prefilled with this comment's content so the
 * agent can spin it off into a new ticket. The source comment is only replaced
 * once that new ticket is actually created; cancelling leaves it untouched.
 */
export function CloneCommentButton({ postId }: { postId: string }) {
  return (
    <Link
      href={`/tickets/new?clone_post=${postId}`}
      className="text-xs text-blue-600 hover:text-blue-800"
      data-testid="clone-comment-btn"
    >
      Clone to new ticket
    </Link>
  );
}

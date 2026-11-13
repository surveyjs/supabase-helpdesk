import Link from 'next/link';
import { POST_ACTION_CLASS } from './post-action-class';

/**
 * Opens the create-ticket page prefilled with this comment's content so the
 * agent can spin it off into a new ticket. The source comment is only replaced
 * once that new ticket is actually created; cancelling leaves it untouched.
 */
export function CloneCommentButton({ postId }: { postId: string }) {
  return (
    <Link
      href={`/tickets/new?clone_post=${postId}`}
      className={`${POST_ACTION_CLASS} hover:text-gray-900`}
      data-testid="clone-comment-btn"
    >
      Clone to new ticket
    </Link>
  );
}

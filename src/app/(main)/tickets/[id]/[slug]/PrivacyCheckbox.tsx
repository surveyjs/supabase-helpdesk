'use client';

import { useRef, useState } from 'react';
import { togglePostPrivacy } from '@/lib/actions/tickets';
import { POST_ACTION_CLASS } from './post-action-class';

export function PrivacyCheckbox({ postId, isPrivate }: { postId: string; isPrivate: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [checked, setChecked] = useState(isPrivate);

  return (
    <form ref={formRef} action={togglePostPrivacy} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="post_id" value={postId} />
      <input
        type="checkbox"
        id={`private-${postId}`}
        checked={checked}
        onChange={() => { setChecked((v) => !v); formRef.current?.requestSubmit(); }}
        className="form-checkbox h-3.5 w-3.5 accent-gray-600 cursor-pointer"
      />
      <label
        htmlFor={`private-${postId}`}
        className={`${POST_ACTION_CLASS} cursor-pointer select-none hover:text-gray-900`}
      >
        Private
      </label>
    </form>
  );
}

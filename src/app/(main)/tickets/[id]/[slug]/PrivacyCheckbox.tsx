'use client';

import { useRef } from 'react';
import { togglePostPrivacy } from '@/lib/actions/tickets';

export function PrivacyCheckbox({ postId, isPrivate }: { postId: string; isPrivate: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={togglePostPrivacy} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="post_id" value={postId} />
      <input
        type="checkbox"
        id={`private-${postId}`}
        defaultChecked={isPrivate}
        onChange={() => formRef.current?.requestSubmit()}
        className="h-3.5 w-3.5 rounded border-gray-300 text-gray-600 accent-gray-600 cursor-pointer"
      />
      <label
        htmlFor={`private-${postId}`}
        className="text-xs text-gray-600 cursor-pointer select-none"
      >
        Private
      </label>
    </form>
  );
}

'use client';

import { useState } from 'react';

export function CopyRedirectUriButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 px-2 py-1 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
      data-testid="copy-redirect-uri"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

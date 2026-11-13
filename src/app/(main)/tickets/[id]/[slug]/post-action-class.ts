/**
 * Shared classes for the small text actions under a post (Edit, Delete,
 * Private, Clone, Publish): on touch screens each grows to a 44 px target.
 * A plain module (no 'use client') so server and client components can share it.
 */
export const POST_ACTION_CLASS =
  'inline-flex items-center [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:px-2';

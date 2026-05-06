'use client';

import { useEffect, useState } from 'react';
import { subscribeTicketDetailFieldChange } from '@/lib/tickets/ticket-detail-events';

type Tag = { id: string; name: string; color: string };

export type TicketTagChipsProps = {
  ticketId: string;
  initialTagIds: string[];
  tagsById: Record<string, Tag>;
};

function getContrastColor(hex: string): string {
  const c = hex.replace('#', '');
  const srgb = [0, 2, 4].map((i) => {
    const v = parseInt(c.substring(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  const ratioWhite = 1.05 / (L + 0.05);
  const ratioDark = (L + 0.05) / 0.05;
  return ratioWhite >= ratioDark ? '#FFFFFF' : '#000000';
}

export function TicketTagChips({ ticketId, initialTagIds, tagsById }: TicketTagChipsProps) {
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);

  useEffect(() => {
    return subscribeTicketDetailFieldChange((detail) => {
      if (detail.ticketId !== ticketId) return;
      if (detail.name !== 'tag_ids') return;
      const next = Array.isArray(detail.value)
        ? detail.value.filter((v): v is string => typeof v === 'string')
        : [];
      setTagIds(next);
    });
  }, [ticketId]);

  const tags = tagIds
    .map((id) => tagsById[id])
    .filter((t): t is Tag => Boolean(t));

  if (tags.length === 0) return null;

  return (
    <div className="mt-3 border-t border-gray-200 pt-3" data-testid="ticket-tags">
      <div className="flex flex-wrap gap-1">
        {tags.map((tag) => {
          const textColor = getContrastColor(tag.color);
          return (
            <span
              key={tag.id}
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: tag.color, color: textColor }}
            >
              {tag.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}

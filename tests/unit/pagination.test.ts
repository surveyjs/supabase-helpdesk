import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { pageWindow, clampPage, Pagination } from '@/components/ui/Pagination';

describe('pageWindow', () => {
  it('shows the first five pages and the last one on page 1', () => {
    expect(pageWindow(1, 128)).toEqual([1, 2, 3, 4, 5, '…', 128]);
  });

  it('centres the window and adds gaps on both sides in the middle', () => {
    expect(pageWindow(64, 128)).toEqual([1, '…', 62, 63, 64, 65, 66, '…', 128]);
  });

  it('shows the last five pages and the first one on the last page', () => {
    expect(pageWindow(128, 128)).toEqual([1, '…', 124, 125, 126, 127, 128]);
  });

  it('lists every page when there are fewer than the window size', () => {
    expect(pageWindow(2, 3)).toEqual([1, 2, 3]);
  });

  it('does not add a gap when the window touches the first or last page', () => {
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, '…', 7]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(4, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('clampPage', () => {
  it('clamps past the last page', () => expect(clampPage(999, 128)).toBe(128));
  it('clamps below 1', () => expect(clampPage(0, 5)).toBe(1));
  it('returns 1 when there are no pages', () => expect(clampPage(3, 0)).toBe(1));
  it('keeps an in-range page', () => expect(clampPage(4, 9)).toBe(4));
});

describe('Pagination markup', () => {
  const render = (props: Record<string, unknown>) =>
    renderToString(createElement(Pagination, { basePath: '/x', totalPages: 3, currentPage: 1, ...props })).replace(/<!-- -->/g, '');

  it('omits the range text when totalItems is 0', () => {
    expect(render({ totalItems: 0 })).not.toMatch(/of 0/);
  });

  it('clamps the range text past the last page', () => {
    expect(render({ currentPage: 999, totalPages: 128, pageSize: 20, totalItems: 2552 })).toContain('2,541–2,552 of 2,552');
  });

  it('renders disabled edge controls as aria-hidden spans, not aria-disabled', () => {
    const html = render({});
    expect(html).not.toContain('aria-disabled');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>First<\/span>/);
  });
});

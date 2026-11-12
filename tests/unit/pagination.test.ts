import { describe, it, expect } from 'vitest';
import { pageWindow } from '@/components/ui/Pagination';

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

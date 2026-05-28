const POPUP_OPENED_EVENT = 'helpdesk:popup-opened';

type PopupOpenedDetail = { id: string };

export function notifyPopupOpened(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<PopupOpenedDetail>(POPUP_OPENED_EVENT, { detail: { id } }),
  );
}

export function subscribeToOtherPopups(
  myId: string,
  onOtherOpened: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  function handler(e: Event) {
    const detail = (e as CustomEvent<PopupOpenedDetail>).detail;
    if (detail && detail.id !== myId) {
      onOtherOpened();
    }
  }
  window.addEventListener(POPUP_OPENED_EVENT, handler);
  return () => window.removeEventListener(POPUP_OPENED_EVENT, handler);
}

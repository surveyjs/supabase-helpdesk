'use client';

import { PluginComponent } from 'react-markdown-editor-lite';

const WIDE_QUERY = '(min-width: 1024px)';

/**
 * Invisible plugin implementing the "Editor + Preview" preference: the editor
 * opens in write mode and the preview pane is added only when the viewport is
 * wide (Tailwind `lg`) and the editor has content. Once the user switches view
 * with the toolbar mode-toggle (detected by its click), the automatic rule stops for this instance.
 * Enabled via `pluginConfig['auto-preview'].enabled`.
 */
class AutoPreviewPlugin extends PluginComponent {
  static pluginName = 'auto-preview';
  static align = 'left';

  private manual = false;
  private mql: MediaQueryList | null = null;
  private anchor: HTMLSpanElement | null = null;
  private host: HTMLElement | null = null;

  // Compares the desired view with the current one on every call, so a missed
  // or reordered event can't leave the preview out of step. `text` is passed by
  // callers that know the new value before the editor's state has caught up.
  private sync = (text: string = this.editor.getMdValue()) => {
    if (this.manual || !this.mql) return;
    const want = this.mql.matches && text.trim().length > 0;
    if (this.editor.getView().html === want) return;
    this.editor.setView({ md: true, html: want });
  };

  private onChange = (text: string) => this.sync(text);
  private onMediaChange = () => this.sync();

  // MarkdownEditor announces values it applies programmatically (canned
  // response, form reset), which the editor itself does not emit 'change' for.
  private onValueApplied = (e: Event) => {
    const text = (e as CustomEvent<{ text?: string }>).detail?.text;
    this.sync(typeof text === 'string' ? text : undefined);
  };

  // A click on the toolbar mode-toggle is the user's explicit choice; stop
  // the automatic rule for this instance.
  private onClickCapture = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('.button-type-mode')) this.manual = true;
  };

  componentDidMount() {
    if (!this.getConfig('enabled', false)) return;
    this.mql = window.matchMedia(WIDE_QUERY);
    this.editor.on('change', this.onChange);
    this.mql.addEventListener('change', this.onMediaChange);
    this.host = this.anchor?.closest<HTMLElement>('[data-testid="markdown-editor"]') ?? null;
    this.host?.addEventListener('mdeditor:value-applied', this.onValueApplied);
    this.host?.addEventListener('click', this.onClickCapture, true);
    this.sync();
  }

  componentWillUnmount() {
    this.editor.off('change', this.onChange);
    this.mql?.removeEventListener('change', this.onMediaChange);
    this.host?.removeEventListener('mdeditor:value-applied', this.onValueApplied);
    this.host?.removeEventListener('click', this.onClickCapture, true);
  }

  render() {
    // Invisible anchor used to locate the owning MarkdownEditor wrapper.
    return (
      <span
        hidden
        ref={(el) => {
          this.anchor = el;
        }}
      />
    );
  }
}

export default AutoPreviewPlugin;

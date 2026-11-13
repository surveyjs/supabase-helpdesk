'use client';

import { PluginComponent } from 'react-markdown-editor-lite';

const WIDE_QUERY = '(min-width: 1024px)';

/**
 * Invisible plugin implementing the "Editor + Preview" preference: the editor
 * opens in write mode and the preview pane is added only when the viewport is
 * wide (Tailwind `lg`) and the editor has content. Once the user switches view
 * with the toolbar mode-toggle, the automatic rule stops for this instance.
 * Enabled via `pluginConfig['auto-preview'].enabled`.
 */
class AutoPreviewPlugin extends PluginComponent {
  static pluginName = 'auto-preview';
  static align = 'left';

  private manual = false;
  private applying = false;
  private mql: MediaQueryList | null = null;

  // The editor emits 'change' before its state updates, so use the emitted
  // value rather than getMdValue() in that case.
  private sync = (text: string = this.editor.getMdValue()) => {
    if (this.manual || !this.mql) return;
    const want = this.mql.matches && text.trim().length > 0;
    if (this.editor.getView().html === want) return;
    this.applying = true;
    this.editor.setView({ md: true, html: want });
  };

  private onChange = (text: string) => this.sync(text);
  private onMediaChange = () => this.sync();

  private onViewChange = () => {
    if (this.applying) {
      this.applying = false;
      return;
    }
    this.manual = true;
  };

  componentDidMount() {
    if (!this.getConfig('enabled', false)) return;
    this.mql = window.matchMedia(WIDE_QUERY);
    this.editor.on('change', this.onChange);
    this.editor.on('viewchange', this.onViewChange);
    this.mql.addEventListener('change', this.onMediaChange);
    this.sync();
  }

  componentWillUnmount() {
    this.editor.off('change', this.onChange);
    this.editor.off('viewchange', this.onViewChange);
    this.mql?.removeEventListener('change', this.onMediaChange);
  }

  render() {
    return null;
  }
}

export default AutoPreviewPlugin;

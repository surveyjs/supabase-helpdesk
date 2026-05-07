'use client';

import { PluginComponent } from 'react-markdown-editor-lite';

/**
 * Toolbar plugin that renders an "Attach file(s)" button. Clicking the button
 * dispatches a bubbling `mdeditor:request-attach-files` CustomEvent which the
 * surrounding `MarkdownEditor` wrapper listens for to open its file-attach
 * dialog. Wiring is intentionally DOM-event based so the plugin remains
 * decoupled from the React tree of its parent editor.
 */
class AttachFilePlugin extends PluginComponent {
  static pluginName = 'attach-file';
  static align = 'left';

  handleClick = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.currentTarget.dispatchEvent(
      new CustomEvent('mdeditor:request-attach-files', { bubbles: true }),
    );
  };

  render() {
    return (
      <span
        className="button"
        title="Attach file(s)"
        aria-label="Attach file(s)"
        onClick={this.handleClick}
        data-testid="attach-files-toolbar-btn"
        style={{ cursor: 'pointer', fontSize: '14px' }}
      >
        📎
      </span>
    );
  }
}

export default AttachFilePlugin;

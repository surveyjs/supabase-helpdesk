'use client';

import { PluginComponent } from 'react-markdown-editor-lite';

const LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

interface State {
  show: boolean;
}

/**
 * Replacement for the library's built-in `header` toolbar plugin. The built-in
 * one renders real `<h1>`–`<h6>` elements in its dropdown, which pollutes the
 * page's heading outline (a11y). This one renders `<span>` items and inserts
 * the same `#`…`######` prefixes through the editor's `insertMarkdown`.
 */
class HeaderPlugin extends PluginComponent<State> {
  static pluginName = 'header';
  static align = 'left';

  state: State = { show: false };

  private show = () => this.setState({ show: true });
  private hide = () => this.setState({ show: false });

  render() {
    return (
      <span
        className="button button-type-header"
        title="Headings"
        aria-label="Headings"
        onMouseEnter={this.show}
        onMouseLeave={this.hide}
      >
        <i className="rmel-iconfont rmel-icon-font-size" />
        <div className={`drop-wrap ${this.state.show ? 'show' : 'hidden'}`} onClick={this.hide}>
          <ul className="header-list">
            {LEVELS.map((level, i) => (
              <li key={level} className="list-item">
                <span
                  className="header-item"
                  data-testid={`editor-heading-${i + 1}`}
                  onClick={() => this.editor.insertMarkdown(level)}
                >
                  {`H${i + 1}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </span>
    );
  }
}

export default HeaderPlugin;

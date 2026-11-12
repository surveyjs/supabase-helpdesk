'use client';

import type { FocusEvent, KeyboardEvent } from 'react';
import { PluginComponent } from 'react-markdown-editor-lite';

const LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

interface State {
  show: boolean;
}

/**
 * Replacement for the library's built-in `header` toolbar plugin. The built-in
 * one renders real `<h1>`–`<h6>` elements in its dropdown, which pollutes the
 * page's heading outline (a11y) and opens on mouse hover only. This one renders
 * `<span>` menu items, works with keyboard/touch, and inserts the same
 * `#`…`######` prefixes through the editor's `insertMarkdown`.
 */
class HeaderPlugin extends PluginComponent<State> {
  static pluginName = 'header';
  static align = 'left';

  state: State = { show: false };

  private rootRef: HTMLSpanElement | null = null;
  private triggerRef: HTMLSpanElement | null = null;
  private itemRefs: Array<HTMLSpanElement | null> = [];

  private show = () => this.setState({ show: true });
  private hide = () => this.setState({ show: false });

  private openAndFocus = (index: number) => {
    this.setState({ show: true }, () => this.itemRefs[index]?.focus());
  };

  private close = (refocusTrigger: boolean) => {
    this.hide();
    if (refocusTrigger) this.triggerRef?.focus();
  };

  private select = (level: (typeof LEVELS)[number]) => {
    this.editor.insertMarkdown(level);
    this.hide();
  };

  private onTriggerKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      this.openAndFocus(0);
    } else if (e.key === 'Escape') {
      this.close(false);
    }
  };

  private onItemKeyDown = (e: KeyboardEvent<HTMLSpanElement>, index: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.itemRefs[(index + 1) % LEVELS.length]?.focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.itemRefs[(index - 1 + LEVELS.length) % LEVELS.length]?.focus();
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.select(LEVELS[index]);
        break;
      case 'Escape':
        e.preventDefault();
        this.close(true);
        break;
    }
  };

  private onBlur = (e: FocusEvent<HTMLSpanElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !this.rootRef?.contains(next)) this.hide();
  };

  render() {
    const { show } = this.state;
    return (
      <span
        ref={(el) => {
          this.rootRef = el;
        }}
        className="button button-type-header"
        title="Header"
        onMouseEnter={this.show}
        onMouseLeave={this.hide}
        onBlur={this.onBlur}
      >
        <span
          ref={(el) => {
            this.triggerRef = el;
          }}
          role="button"
          tabIndex={0}
          aria-label="Header"
          aria-haspopup="menu"
          aria-expanded={show}
          onClick={this.show}
          onKeyDown={this.onTriggerKeyDown}
        >
          <i className="rmel-iconfont rmel-icon-font-size" />
        </span>
        <div className={`drop-wrap ${show ? 'show' : 'hidden'}`}>
          <ul className="header-list" role="menu" aria-label="Header">
            {LEVELS.map((level, i) => (
              <li key={level} className="list-item" role="none">
                <span
                  ref={(el) => {
                    this.itemRefs[i] = el;
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  className="header-item"
                  data-testid={`editor-heading-${i + 1}`}
                  onClick={() => this.select(level)}
                  onKeyDown={(e) => this.onItemKeyDown(e, i)}
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

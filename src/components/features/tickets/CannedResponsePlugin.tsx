'use client';

import { PluginComponent } from 'react-markdown-editor-lite';
import { searchCannedResponses } from '@/lib/actions/canned-responses';

interface CannedState {
  open: boolean;
  query: string;
  results: { id: string; title: string; body: string }[];
}

class CannedResponsePlugin extends PluginComponent<CannedState> {
  static pluginName = 'canned-response';
  static align = 'left';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private containerRef: HTMLSpanElement | null = null;
  state: CannedState = { open: false, query: '', results: [] };
  private handleOutsideClick = (e: MouseEvent) => {
    if (this.containerRef && !this.containerRef.contains(e.target as Node)) {
      this.setState({ open: false });
    }
  };

  componentDidMount() {
    document.addEventListener('mousedown', this.handleOutsideClick);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleOutsideClick);
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    this.setState({ query });

    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (query.length < 1) {
      this.setState({ results: [] });
      return;
    }

    this.searchTimer = setTimeout(async () => {
      const res = await searchCannedResponses(query);
      this.setState({ results: res });
    }, 300);
  };

  handleSelect = (body: string) => {
    this.editor.insertText(body);
    this.setState({ open: false, query: '', results: [] });
  };

  render() {
    const { open, query, results } = this.state;
    return (
      <span
        className="button"
        title="Insert canned response"
        ref={(el) => { this.containerRef = el; }}
        style={{ position: 'relative' }}
      >
        <span
          onClick={() => this.setState({ open: !open })}
          style={{ cursor: 'pointer', fontSize: '14px' }}
          data-testid="canned-response-toolbar-btn"
        >
          📋
        </span>
        {open && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 50,
              marginTop: '4px',
              width: '320px',
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              padding: '8px',
            }}
          >
            <input
              type="text"
              value={query}
              onChange={this.handleQueryChange}
              placeholder="Search canned responses…"
              style={{
                width: '100%',
                padding: '4px 8px',
                fontSize: '13px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                marginBottom: '8px',
                outline: 'none',
              }}
              autoFocus
            />
            <div style={{ maxHeight: '192px', overflowY: 'auto' }}>
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => this.handleSelect(r.body)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '4px 8px',
                    fontSize: '13px',
                    borderRadius: '4px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f3f4f6')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <span style={{ fontWeight: 500 }}>{r.title}</span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      color: '#6b7280',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.body}
                  </span>
                </button>
              ))}
              {query && results.length === 0 && (
                <p style={{ fontSize: '12px', color: '#9ca3af', padding: '4px 8px' }}>No matches</p>
              )}
            </div>
          </div>
        )}
      </span>
    );
  }
}

export default CannedResponsePlugin;

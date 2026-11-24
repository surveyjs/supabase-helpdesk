'use client';

import { PluginComponent } from 'react-markdown-editor-lite';
import { searchCannedResponses } from '@/lib/actions/canned-responses';

interface CannedState {
  open: boolean;
  query: string;
  results: { id: string; title: string; body: string }[];
  /** False until the first response for the current popup arrives. */
  loaded: boolean;
}

class CannedResponsePlugin extends PluginComponent<CannedState> {
  static pluginName = 'canned-response';
  static align = 'left';

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private containerRef: HTMLSpanElement | null = null;
  /** Bumped per request so a slow, older response can't overwrite a newer one. */
  private requestSeq = 0;
  state: CannedState = { open: false, query: '', results: [], loaded: false };
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

  /** Fetch responses matching `query`; an empty query lists them all (#115). */
  private load = async (query: string) => {
    const seq = ++this.requestSeq;
    const res = await searchCannedResponses(query);
    if (seq !== this.requestSeq) return;
    this.setState({ results: res, loaded: true });
  };

  handleToggle = () => {
    if (this.state.open) {
      this.setState({ open: false });
      return;
    }
    // Show the list as soon as the popup opens, not only after a search.
    this.setState({ open: true, query: '', results: [], loaded: false });
    void this.load('');
  };

  handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    this.setState({ query });

    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (!query.trim()) {
      // Cleared: back to the full list right away.
      void this.load('');
      return;
    }

    this.searchTimer = setTimeout(() => {
      void this.load(query);
    }, 300);
  };

  handleSelect = (body: string) => {
    this.editor.insertText(body);
    this.setState({ open: false, query: '', results: [], loaded: false });
  };

  render() {
    const { open, query, results, loaded } = this.state;
    return (
      <span
        className="button"
        title="Insert canned response"
        ref={(el) => { this.containerRef = el; }}
        style={{ position: 'relative' }}
      >
        <span
          onClick={this.handleToggle}
          style={{ cursor: 'pointer', fontSize: '14px' }}
          data-testid="canned-response-toolbar-btn"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, display: 'inline' }} aria-hidden="true">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
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
              {!loaded && results.length === 0 && (
                <p style={{ fontSize: '12px', color: '#9ca3af', padding: '4px 8px' }}>Loading…</p>
              )}
              {loaded && results.length === 0 && (
                <p style={{ fontSize: '12px', color: '#9ca3af', padding: '4px 8px' }} data-testid="canned-response-empty">
                  {query.trim() ? 'No matches' : 'No canned responses yet'}
                </p>
              )}
            </div>
          </div>
        )}
      </span>
    );
  }
}

export default CannedResponsePlugin;

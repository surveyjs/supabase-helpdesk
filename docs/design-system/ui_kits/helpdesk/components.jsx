// HelpDesk UI Kit — reusable atoms
// Mirrors src/components/ui/{Badge,Pagination,TierBadge}.tsx from
// surveyjs/supabase-helpdesk, plus a few shared primitives the codebase
// composes inline (Button, Input, Card).

const { useState } = React;

/* ---------- Badge — ticket status / priority ---------- */
const STATUS_COLORS = {
  open:    'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  closed:  'bg-gray-100 text-gray-700',
};
const PRIORITY_COLORS = {
  low:      'bg-blue-100 text-blue-700',
  medium:   'bg-teal-100 text-teal-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

function Badge({ variant, value, label }) {
  const colors = variant === 'status' ? STATUS_COLORS : PRIORITY_COLORS;
  const c = colors[value] ?? 'bg-gray-100 text-gray-700';
  const display = label ?? (value[0].toUpperCase() + value.slice(1));
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c}`}>{display}</span>;
}

/* ---------- TierBadge ---------- */
const TIER_COLOR_MAP = {
  gray:   'bg-gray-100 text-gray-700',
  blue:   'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  green:  'bg-green-100 text-green-700',
  red:    'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  orange: 'bg-orange-100 text-orange-700',
  pink:   'bg-pink-100 text-pink-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  teal:   'bg-teal-100 text-teal-700',
};
function TierBadge({ displayName, color, icon }) {
  const cls = TIER_COLOR_MAP[color] ?? TIER_COLOR_MAP.gray;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon && <span className="mr-0.5">{icon}</span>}
      {displayName}
    </span>
  );
}

/* ---------- RoleBadge (from NavBar.tsx) ---------- */
function RoleBadge({ role }) {
  if (role === 'admin') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Admin</span>;
  if (role === 'agent') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Agent</span>;
  return null;
}

/* ---------- Button — the codebase doesn't have a Button component, it
   inlines Tailwind everywhere. This consolidates the patterns. ---------- */
function Button({ variant = 'primary', size = 'md', as = 'button', disabled, children, className = '', ...rest }) {
  const base = 'inline-flex items-center justify-center font-medium rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 transition-colors';
  const sizes = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'py-2 px-4 text-sm',
  };
  const variants = {
    primary:   'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50',
    secondary: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    outline:   'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
    danger:    'bg-red-600 text-white hover:bg-red-700',
    ghost:     'text-blue-600 hover:text-blue-800 hover:bg-blue-50',
  };
  const Cmp = as;
  return <Cmp className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={disabled} {...rest}>{children}</Cmp>;
}

/* ---------- Input / Textarea ---------- */
function Input({ id, label, error, type = 'text', className = '', ...rest }) {
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <input
        id={id}
        type={type}
        className={`block w-full rounded border ${error ? 'border-red-400' : 'border-gray-300'} px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none`}
        {...rest}
      />
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}
function Textarea({ id, label, rows = 4, className = '', ...rest }) {
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <textarea id={id} rows={rows} className="block w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-y" {...rest} />
    </div>
  );
}
function Select({ id, label, children, className = '', ...rest }) {
  return (
    <div className={className}>
      {label && <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <select id={id} className="block w-full rounded border border-gray-300 px-3 py-2 text-sm bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none" {...rest}>{children}</select>
    </div>
  );
}

/* ---------- Card — the canonical surface ---------- */
function Card({ className = '', children }) {
  return <div className={`bg-white rounded-lg border border-gray-200 ${className}`}>{children}</div>;
}

/* ---------- Banner (alerts) ---------- */
function Banner({ tone = 'info', children }) {
  const tones = {
    error:   'bg-red-50 border-red-200 text-red-700',
    warning: 'bg-amber-50 border-amber-300 text-amber-800',
    info:    'bg-blue-50 border-blue-200 text-blue-800',
    success: 'bg-green-50 border-green-200 text-green-700',
  };
  return <div role="alert" className={`mb-4 p-3 rounded-md border text-sm ${tones[tone]}`}>{children}</div>;
}

/* ---------- Pagination (numeric strip) ---------- */
function Pagination({ currentPage, totalPages, onPage }) {
  if (totalPages <= 1) return null;
  const pages = [];
  const maxVisible = 5;
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  const end = Math.min(totalPages, start + maxVisible - 1);
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  const btn = 'px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50';
  const cur = 'px-3 py-1.5 text-sm rounded border bg-blue-600 text-white border-blue-600';
  return (
    <nav className="flex items-center justify-center gap-1 mt-6" aria-label="Pagination">
      {currentPage > 1 && <button className={btn} onClick={() => onPage(currentPage - 1)}>Previous</button>}
      {pages.map(p => (
        <button key={p} className={p === currentPage ? cur : btn} onClick={() => onPage(p)} aria-current={p === currentPage ? 'page' : undefined}>{p}</button>
      ))}
      {currentPage < totalPages && <button className={btn} onClick={() => onPage(currentPage + 1)}>Next</button>}
    </nav>
  );
}

/* ---------- Icon — outline-style inline SVGs (Heroicons-compatible) ---------- */
const Icon = ({ name, className = 'h-5 w-5' }) => {
  const props = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  switch (name) {
    case 'bell':       return <svg {...props}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>;
    case 'chevron-down': return <svg {...props}><path d="M6 9l6 6 6-6"/></svg>;
    case 'menu':       return <svg {...props}><path d="M4 6h16M4 12h16M4 18h16"/></svg>;
    case 'close':      return <svg {...props}><path d="M6 6l12 12M18 6l-12 12"/></svg>;
    case 'search':     return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>;
    case 'filter':     return <svg {...props}><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg>;
    case 'paperclip':  return <svg {...props}><path d="M21 12l-9 9a5 5 0 0 1-7-7l9-9a3 3 0 0 1 4 4l-9 9a1 1 0 0 1-1-1l8-8"/></svg>;
    case 'lock':       return <svg {...props}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
    case 'sparkles':   return <svg {...props}><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 16l.7 2 2 .7-2 .7L19 22l-.7-2-2-.7 2-.7z"/></svg>;
    case 'arrow-left': return <svg {...props}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>;
    case 'check':      return <svg {...props}><path d="M5 12l5 5L20 7"/></svg>;
    case 'tag':        return <svg {...props}><path d="M3 12l9-9h9v9l-9 9z"/><circle cx="16" cy="8" r="1.5"/></svg>;
    case 'plus':       return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    default:           return <svg {...props}><circle cx="12" cy="12" r="9"/></svg>;
  }
};

/* ---------- Export ---------- */
Object.assign(window, { Badge, TierBadge, RoleBadge, Button, Input, Textarea, Select, Card, Banner, Pagination, Icon });

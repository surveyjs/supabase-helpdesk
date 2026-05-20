// HelpDesk Top NavBar — mirrors src/components/layout/NavBar.tsx

function HDNavBar({ route, onNavigate, user }) {
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const isAgent = user && (user.role === 'agent' || user.role === 'admin');
  const isAdmin = user && user.role === 'admin';

  // Top-level nav links (the codebase puts My Tickets in user-menu for agents)
  const navLinks = [];
  if (user && !isAgent) navLinks.push({ to: 'my-tickets', label: 'My Tickets' });
  if (isAgent)          navLinks.push({ to: 'agent', label: 'Agent Dashboard' });
  navLinks.push({ to: 'help', label: 'Help Center' });
  if (isAgent)          navLinks.push({ to: 'kb-manage', label: 'Manage Articles' });

  const userMenuLinks = [];
  if (isAdmin) userMenuLinks.push({ to: 'admin', label: 'Setup' });
  if (isAgent) {
    userMenuLinks.push({ to: 'my-tickets', label: 'My Tickets' });
    userMenuLinks.push({ to: 'reports', label: 'Reports' });
    userMenuLinks.push({ to: 'canned', label: 'Canned Responses' });
  }
  userMenuLinks.push({ to: 'profile', label: 'Profile' });
  userMenuLinks.push({ to: 'notif-settings', label: 'Notification Settings' });

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3 relative" aria-label="Main navigation">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-4">
          <a
            onClick={(e) => { e.preventDefault(); onNavigate(user ? (isAgent ? 'agent' : 'my-tickets') : 'help'); }}
            href="#"
            className="flex items-center gap-2 text-lg font-semibold text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded"
          >
            <img src="../../assets/mark.svg" alt="" className="h-6 w-6"/>
            <span>HelpDesk</span>
          </a>

          {/* Mobile hamburger */}
          <button
            className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(v => !v)}
          >
            <Icon name={mobileOpen ? 'close' : 'menu'} className="h-6 w-6"/>
          </button>

          {/* Desktop links */}
          <ul className="hidden md:flex items-center gap-1 ml-2">
            {navLinks.map(l => {
              const active = route === l.to;
              return (
                <li key={l.to}>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); onNavigate(l.to); }}
                    className={`px-3 py-1.5 rounded text-sm min-h-[44px] inline-flex items-center ${active ? 'text-blue-700 font-medium bg-blue-50' : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50'}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    {l.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* Notification bell with unread count */}
              <button className="relative min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-gray-600 hover:text-gray-900 hover:bg-gray-100" aria-label="Notifications (3 unread)">
                <Icon name="bell" className="h-5 w-5"/>
                <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 px-1 inline-flex items-center justify-center">3</span>
              </button>

              {/* User dropdown */}
              <div className="hidden sm:relative sm:block">
                <button
                  onClick={() => setUserMenuOpen(v => !v)}
                  className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 min-h-[44px] px-2 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                  aria-haspopup="true"
                  aria-expanded={userMenuOpen}
                >
                  <span>{user.displayName}</span>
                  <RoleBadge role={user.role}/>
                  <Icon name="chevron-down" className="h-4 w-4"/>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-52 bg-white rounded border border-gray-200 shadow-lg py-1 z-50" role="menu">
                    {userMenuLinks.map(link => (
                      <a key={link.to} href="#" onClick={(e) => { e.preventDefault(); setUserMenuOpen(false); onNavigate(link.to); }} className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center">
                        {link.label}
                      </a>
                    ))}
                    <button onClick={() => { setUserMenuOpen(false); onNavigate('sign-out'); }} className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center" role="menuitem">
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate('login'); }} className="text-sm text-blue-600 hover:text-blue-800 min-h-[44px] flex items-center px-2 rounded">Log in</a>
          )}
        </div>
      </div>

      {/* Mobile menu drawer */}
      {mobileOpen && (
        <div className="md:hidden absolute left-0 right-0 top-full bg-white border-b border-gray-200 shadow-lg z-50 py-2">
          <ul className="flex flex-col">
            {navLinks.map(l => (
              <li key={l.to}>
                <a href="#" onClick={(e) => { e.preventDefault(); setMobileOpen(false); onNavigate(l.to); }} className={`block px-4 py-3 min-h-[44px] text-sm ${route === l.to ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}

window.HDNavBar = HDNavBar;

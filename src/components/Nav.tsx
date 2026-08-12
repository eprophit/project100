'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const GROUPS: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Today', icon: '◈' },
      { href: '/explorer', label: 'Explorer', icon: '◫' },
      { href: '/coach', label: 'Coach', icon: '✦' },
    ],
  },
  {
    label: 'Log',
    items: [
      { href: '/training', label: 'Training', icon: '⏱' },
      { href: '/nutrition', label: 'Nutrition', icon: '◍' },
      { href: '/recovery', label: 'Recovery', icon: '☾' },
      { href: '/labs', label: 'Biomarkers', icon: '⬡' },
    ],
  },
  {
    label: 'System',
    items: [{ href: '/connections', label: 'Connections', icon: '⇄' }],
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sidebar">
      <Link href="/" className="brand">
        <span className="brand-mark">V</span>
        <span>
          <div className="brand-name">Vitalis</div>
          <div className="brand-sub">Health OS</div>
        </span>
      </Link>

      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="nav-link"
                aria-current={active ? 'page' : undefined}
              >
                <span className="nav-icon" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

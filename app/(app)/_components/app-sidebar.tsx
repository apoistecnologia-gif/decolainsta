'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Instagram,
  Bell,
  Activity,
  Zap,
  Shield,
  Sparkles,
  ListChecks,
  CalendarClock,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/accounts', label: 'Contas', icon: Instagram },
  { href: '/references', label: 'Contas de referência', icon: ListChecks },
  { href: '/reference-ai', label: 'IA · Referências', icon: Sparkles },
  { href: '/scheduled-posts', label: 'Publicações agendadas', icon: CalendarClock },
  { href: '/activity', label: 'Atividade', icon: Activity },
  { href: '/alerts', label: 'Alertas', icon: Bell },
  { href: '/engine', label: 'Motor', icon: Zap },
];

export function AppSidebar({ user }: { user: any }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-4">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <Zap className="h-4 w-4 text-primary-foreground" />
        </div>
        <div>
          <h2 className="font-display text-sm font-bold tracking-tight">DecolaInsta</h2>
          <p className="text-xs text-muted-foreground">Sistema de Crescimento</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 mt-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t pt-4">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center">
            <Shield className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="overflow-hidden">
            <p className="text-xs font-medium truncate">{user?.name ?? 'Usuário'}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email ?? ''}</p>
          </div>
        </div>
        <p className="px-3 py-2 text-[10px] text-muted-foreground">
          ⚠️ Automação viola os Termos do Instagram. Use por sua conta e risco.
        </p>
      </div>
    </div>
  );
}

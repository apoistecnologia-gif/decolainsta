'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export function AppHeader({ user }: { user: any }) {
  return (
    <div className="flex items-center justify-between w-full">
      <div />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ redirectTo: '/login' })}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </Button>
      </div>
    </div>
  );
}

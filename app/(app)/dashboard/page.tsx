'use client';

import { AbacusDashboard, useDashboardData } from '@/components/viz/abacus-dashboard';
import { manifest } from '@/lib/dashboard-manifest';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardPage() {
  const { data, dataAsOf, error } = useDashboardData('/api/dashboard', 60_000);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Erro ao carregar dados do dashboard.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  return <AbacusDashboard manifest={manifest} data={data} dataAsOf={dataAsOf} className="min-h-screen" />;
}

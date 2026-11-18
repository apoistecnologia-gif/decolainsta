/**
 * Métricas observadas pela API oficial da Meta.
 * A variação mede saldo entre observações; não atribui seguidores a nenhuma ação.
 * Nunca cria valores quando a API não disponibiliza followers_count.
 */
export interface FollowersMeasurement {
  current: number;
  previous: number | null;
  delta: number | null;
  source: 'meta_official_api';
}

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function measureFollowers(
  current: unknown,
  previous: unknown,
): FollowersMeasurement | null {
  if (!isValidCount(current)) return null;
  const baseline = isValidCount(previous) ? previous : null;
  return {
    current,
    previous: baseline,
    delta: baseline === null ? null : current - baseline,
    source: 'meta_official_api',
  };
}

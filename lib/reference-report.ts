/** Public aggregate-only preview format. No usernames of observed followers. */
export type ReferenceAggregate = {
  format: 'decolainsta-reference-aggregate-v1';
  reference: string;
  generatedAt: string;
  source: 'manual_lab_aggregate';
  verifiedFollowerList: false;
  followbackVerified: false;
  summary: {
    inspections: number;
    distinctObserved: number;
    manuallyReported: number;
    repeatedSeen: number;
    lastSeen: string | null;
  };
  visits: Array<{
    observedAt: string;
    source: 'manual_report_from_previous_check' | 'manually_opened_dialog_user_confirmed';
    sampleSize: number;
    uniqueNew: number | null;
    repeated: number | null;
    crossReferenceOverlap: number | null;
  }>;
};

const handleRe = /^[a-zA-Z0-9._]{1,30}$/;
function dateOk(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && value.length <= 40;
}
function smallInteger(value: unknown, max = 500): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;
}
function countOrNull(value: unknown) {
  return value === null || smallInteger(value, 5);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
export function parseReferenceAggregate(text: string): ReferenceAggregate {
  if (typeof text !== 'string' || text.length > 50_000) throw new Error('Arquivo maior que 50 KB ou inválido.');
  let obj: unknown;
  try { obj = JSON.parse(text); }
  catch { throw new Error('JSON inválido.'); }
  if (!isRecord(obj)) throw new Error('Relatório inválido.');
  if (obj.format !== 'decolainsta-reference-aggregate-v1' ||
    obj.source !== 'manual_lab_aggregate' || obj.verifiedFollowerList !== false ||
    obj.followbackVerified !== false || !handleRe.test(String(obj.reference)) ||
    !dateOk(obj.generatedAt) || !isRecord(obj.summary) || !Array.isArray(obj.visits) ||
    obj.visits.length > 10) throw new Error('Relatório não corresponde ao formato agregado local.');
  const s = obj.summary;
  if (!smallInteger(s.inspections, 100) || !smallInteger(s.distinctObserved) ||
      !smallInteger(s.manuallyReported) || !smallInteger(s.repeatedSeen) ||
      (s.lastSeen !== null && !dateOk(s.lastSeen))) {
    throw new Error('Contadores inválidos.');
  }
  for (const v of obj.visits) {
    if (!isRecord(v) || !dateOk(v.observedAt) ||
        !['manual_report_from_previous_check', 'manually_opened_dialog_user_confirmed'].includes(String(v.source)) ||
        !smallInteger(v.sampleSize, 5) || !countOrNull(v.uniqueNew) ||
        !countOrNull(v.repeated) || !countOrNull(v.crossReferenceOverlap)) {
      throw new Error('Verificação inválida no histórico.');
    }
  }
  return obj as ReferenceAggregate;
}

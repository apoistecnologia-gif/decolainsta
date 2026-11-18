import { isPublicImageUrl } from './meta';

export type ScheduledPostDraft = {
  imageUrl: string;
  caption: string;
  scheduledFor: Date;
};

/** One explicit, dated JPEG post, not an automatic content generator. UTC noon is 09:00 Recife. */
export function validateScheduledPost(value: unknown, now = new Date()): ScheduledPostDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Dados da publicação inválidos');
  }
  const input = value as Record<string, unknown>;
  if (!isPublicImageUrl(input.imageUrl)) {
    throw new Error('Informe uma URL HTTPS pública e válida para a imagem');
  }
  const image = new URL(input.imageUrl);
  if (!/\.jpe?g$/i.test(image.pathname)) {
    throw new Error('Informe um arquivo JPEG público (.jpg ou .jpeg)');
  }
  if (typeof input.caption !== 'string' || input.caption.length > 2200) {
    throw new Error('A legenda deve ter no máximo 2.200 caracteres');
  }
  const day = input.day;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error('Informe uma data no formato AAAA-MM-DD');
  }
  const scheduledFor = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(scheduledFor.getTime()) || scheduledFor.toISOString().slice(0, 10) !== day) {
    throw new Error('Data inválida');
  }
  if (scheduledFor.getTime() <= now.getTime() + 15 * 60_000) {
    throw new Error('Escolha uma data futura; o processamento ocorre diariamente por volta das 9h (Recife)');
  }
  if (scheduledFor.getTime() > now.getTime() + 90 * 24 * 60 * 60_000) {
    throw new Error('Agende com até 90 dias de antecedência');
  }
  return { imageUrl: input.imageUrl, caption: input.caption, scheduledFor };
}

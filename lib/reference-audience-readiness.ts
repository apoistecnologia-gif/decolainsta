import type { AudienceRefreshSource } from './reference-audience-refresh';

export type AudienceReadinessFlags = {
  readOnlyEnabled: boolean;
  pollingEnabled: boolean;
  cronSecretConfigured: boolean;
  providerKeyConfigured: boolean;
};

export type AudienceReference = { id: string; username: string; enabled: boolean };

/** Preflight is tenant-scoped. Never assume a particular Instagram username. */
export function evaluateAudienceReadiness(
  accountId: string,
  references: AudienceReference[],
  sources: AudienceRefreshSource[],
  flags: AudienceReadinessFlags,
) {
  const configured = new Set(sources.filter(source =>
    source.accountId === accountId).map(source => source.referenceId));
  const active = references.filter(reference => reference.enabled);
  const assigned = active.filter(reference => configured.has(reference.id));
  const missing = active.filter(reference => !configured.has(reference.id))
    .map(reference => '@' + reference.username);
  const missingConfiguration: string[] = [];
  if (!flags.readOnlyEnabled)
    missingConfiguration.push('PHANTOMBUSTER_READONLY_ENABLED');
  if (!flags.pollingEnabled)
    missingConfiguration.push('PHANTOMBUSTER_AUDIENCE_POLL_ENABLED');
  if (!flags.cronSecretConfigured) missingConfiguration.push('CRON_SECRET');
  if (!flags.providerKeyConfigured) missingConfiguration.push('PHANTOMBUSTER_API_KEY');
  if (missing.length) missingConfiguration.push('VINCULOS_DE_COLETORES');
  const technicalReady = active.length > 0 && missingConfiguration.length === 0;
  const previewManualReady = active.length > 0 &&
    missingConfiguration.filter(name => name !== 'CRON_SECRET').length === 0;
  return {
    technicalReady,
    previewManualReady,
    referenceCount: active.length,
    assignedCollectors: assigned.length,
    missingCollectorFor: missing,
    missingConfiguration,
    collectorTypeVerified: false,
    collectorResultsVerified: false,
    instagramActionsEnabled: false,
  };
}

export function isConfiguredPhantomBusterKey(value: string | undefined): value is string {
  return !!value && value.length >= 12 && value.length <= 512 &&
    /^[\x21-\x7e]+$/.test(value) && !/sessionid|instagram|%3a|[;\s]/i.test(value);
}

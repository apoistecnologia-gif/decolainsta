import { parseSingleInstagramReference } from './providers/phantombuster-collector-discovery';

/**
 * Admission control for a FUTURE sequential shared-collector reader.
 *
 * A Phantom can accept multiple URLs, but follower result rows do not carry a
 * documented, trustworthy source-reference identity. Therefore each accepted
 * run must have exactly ONE reference in a provider-verified run snapshot.
 *
 * Do not treat this helper as proof of Instagram follower relationships or as
 * an agent launch implementation. Callers must independently obtain trusted
 * account ownership, the immutable pre-run claim and provider run metadata.
 */
export type CollectorRunScope = Readonly<{
  accountId: string;
  referenceId: string;
  referenceUsername: string;
  collectorAgentId: string;
  containerId: string;
}>;

export type CollectorRunProof = Readonly<{
  accountId: string;
  referenceId: string;
  collectorAgentId: string;
  containerId: string;
  // Verified against the input actually used by THIS completed container,
  // never the editable/current agent arguments.
  inputProfileUrls: readonly string[];
  inputEvidence: 'provider-run-snapshot' | 'current-agent-configuration' | 'unverified';
  claimRecordedBeforeLaunch: boolean;
  containerState: 'finalized' | 'running' | 'unknown';
  resultLocation: 'completed_run' | 'latest_agent_file';
}>;

export type CollectorAdmission =
  | Readonly<{ allowed: true; source: 'run_scoped_single_reference'; accountId: string; referenceId: string }>
  | Readonly<{ allowed: false; reason:
      'invalid-scope' | 'missing-evidence' | 'cross-account' |
      'reference-mismatch' | 'agent-mismatch' | 'container-mismatch' |
      'input-not-verifiable' | 'multi-source-ambiguous' | 'not-finalized' |
      'not-run-scoped' | 'claim-not-preexisting' }>;

const validLocalId = (v: unknown) =>
  typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const validProviderId = (v: unknown) =>
  typeof v === 'string' && /^\d{10,25}$/.test(v);

/** Do not call the existing username-only importer unless this succeeds. */
export function admitSequentialCollectorRun(
  expected: CollectorRunScope,
  proof: CollectorRunProof | null,
): CollectorAdmission {
  const invalid = (reason: Exclude<CollectorAdmission, { allowed: true }>['reason']): CollectorAdmission =>
    ({ allowed: false, reason });
  if (!validLocalId(expected.accountId) || !validLocalId(expected.referenceId) ||
      !validProviderId(expected.collectorAgentId) ||
      !validProviderId(expected.containerId) ||
      parseSingleInstagramReference(expected.referenceUsername) !== expected.referenceUsername)
    return invalid('invalid-scope');
  if (!proof) return invalid('missing-evidence');
  if (proof.accountId !== expected.accountId) return invalid('cross-account');
  if (proof.referenceId !== expected.referenceId) return invalid('reference-mismatch');
  if (proof.collectorAgentId !== expected.collectorAgentId) return invalid('agent-mismatch');
  if (proof.containerId !== expected.containerId) return invalid('container-mismatch');
  if (proof.claimRecordedBeforeLaunch !== true) return invalid('claim-not-preexisting');
  if (proof.containerState !== 'finalized') return invalid('not-finalized');
  if (proof.resultLocation !== 'completed_run') return invalid('not-run-scoped');
  if (proof.inputEvidence !== 'provider-run-snapshot')
    return invalid('input-not-verifiable');
  if (!Array.isArray(proof.inputProfileUrls) || proof.inputProfileUrls.length !== 1)
    return invalid('multi-source-ambiguous');
  const source = parseSingleInstagramReference(proof.inputProfileUrls[0]);
  if (!source || source !== expected.referenceUsername)
    return invalid('reference-mismatch');
  return {
    allowed: true, source: 'run_scoped_single_reference',
    accountId: expected.accountId, referenceId: expected.referenceId,
  };
}

/** Read-only capability report; it does not select an agent or start any job. */
export function sequentialCollectorReadiness(eligibleReferences: number) {
  return {
    mode: 'one_reference_per_execution' as const,
    pendingReferences: Math.max(0, Number.isSafeInteger(eligibleReferences) ? eligibleReferences : 0),
    mayShareOneAgentSequentially: true,
    collectorAssigned: false,
    providerRunInputVerified: false,
    exclusiveAgentLeaseImplemented: false,
    exclusiveAgentClaimPrepared: true,
    exclusiveAgentLeaseEnabled: false,
    importsEnabled: false,
    actionsEnabled: false,
  };
}

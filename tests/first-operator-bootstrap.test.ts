import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  eligibleFirstOperator, explicitFirstOperatorApproval,
  FIRST_OPERATOR_CONFIRMATION, type FirstOperatorSnapshot,
} from '../lib/first-operator-bootstrap';

const baseline: FirstOperatorSnapshot = {
  requestedEmail: 'verified.owner@example.test',
  knownUserCount: 1,
  adminCount: 0,
  candidate: {
    email: 'verified.owner@example.test',
    role: 'user',
    hasPasswordHash: true,
  },
};

test('first operator must match exactly one existing non-admin account', () => {
  assert.equal(eligibleFirstOperator(baseline), true);
  assert.equal(eligibleFirstOperator({
    ...baseline, requestedEmail: 'other@example.test',
  }), false);
  assert.equal(eligibleFirstOperator({
    ...baseline, candidate: {...baseline.candidate!,role:'admin'},
  }), false);
  assert.equal(eligibleFirstOperator({
    ...baseline, candidate: {...baseline.candidate!,hasPasswordHash:false},
  }), false);
  assert.equal(eligibleFirstOperator({...baseline, knownUserCount:2}), false);
  assert.equal(eligibleFirstOperator({...baseline, knownUserCount:0}), false);
  assert.equal(eligibleFirstOperator({...baseline, adminCount:1}), false);
  assert.equal(eligibleFirstOperator({...baseline, candidate:null}), false);
  assert.equal(eligibleFirstOperator({...baseline, requestedEmail:''}), false);
});

test('only exact approval can enable a first-operator write', () => {
  assert.equal(explicitFirstOperatorApproval('check', undefined, undefined),true);
  assert.equal(explicitFirstOperatorApproval('apply', undefined, 'preview'),false);
  assert.equal(explicitFirstOperatorApproval('apply', 'yes', 'preview'),false);
  assert.equal(explicitFirstOperatorApproval('apply',
    FIRST_OPERATOR_CONFIRMATION,'preview'),true);
  assert.equal(explicitFirstOperatorApproval('apply',
    FIRST_OPERATOR_CONFIRMATION,'production'),false);
  assert.equal(explicitFirstOperatorApproval(undefined,
    FIRST_OPERATOR_CONFIRMATION,undefined),false);
});

test('admin activation is offline, password checked and transactionally guarded', () => {
  const source = readFileSync('scripts/bootstrap-first-operator.ts','utf8');
  for (const token of [
    "process.env.FIRST_OPERATOR_MODE ?? 'check'",
    'explicitFirstOperatorApproval(',
    'pg_advisory_xact_lock',
    'eligibleFirstOperator(',
    'bcrypt.compare(password, candidate.password)',
    "if (mode === 'check') return 'verified-without-write'",
    'tx.user.updateMany(',
    'Prisma.TransactionIsolationLevel.Serializable',
  ]) assert.ok(source.includes(token), token);
  for (const forbidden of ['fetch(', 'NextResponse', 'export async function POST', 'user.create('])
    assert.ok(!source.includes(forbidden), forbidden);
  const seed = readFileSync('scripts/seed.ts','utf8');
  assert.match(seed,/Seed não alterou a senha nem o nível de acesso/);
});

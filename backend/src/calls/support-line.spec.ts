/** Run with `npm test`. Rules for the AI-first support line. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterAiLeg, bareNumber, isSupportNumber, matchPerson } from './support-line';

describe('support numbers', () => {
  it('matches a number however it is written', () => {
    assert.equal(bareNumber('+1 (347) 778-3521'), '13477783521');
    assert.equal(bareNumber('0013477783521'), '13477783521');
    assert.equal(isSupportNumber(['+13477783521'], '13477783521'), true);
    assert.equal(isSupportNumber(['+13477783521'], '+1 347 778 3521'), true);
  });

  it('does not match other or missing numbers', () => {
    assert.equal(isSupportNumber(['+13477783521'], '+13477783522'), false);
    assert.equal(isSupportNumber(['+13477783521'], undefined), false);
    assert.equal(isSupportNumber([], '+13477783521'), false);
    assert.equal(isSupportNumber([''], ''), false);
  });
});

describe('after the AI leg ends', () => {
  it('ends the call only when the AI said the caller is done', () => {
    assert.deepEqual(afterAiLeg({ handoff: { action: 'hangup' } }, { aiAnswered: true }), {
      action: 'hangup',
    });
  });

  it('rings the person asked for on a transfer', () => {
    assert.deepEqual(
      afterAiLeg({ handoff: { action: 'transfer', person: 'Ravi' } }, { aiAnswered: true }),
      { action: 'person', person: 'Ravi' },
    );
  });

  it('rings a person when the AI never answered or went quiet', () => {
    assert.deepEqual(afterAiLeg({}, { aiAnswered: false }), { action: 'person' });
    assert.deepEqual(afterAiLeg({}, { aiAnswered: true }), { action: 'person', person: undefined });
    assert.deepEqual(afterAiLeg(null, { aiAnswered: true }), { action: 'person', person: undefined });
    // A "hangup" that arrived for a leg the AI never picked up is not trusted.
    assert.deepEqual(afterAiLeg({ handoff: { action: 'hangup' } }, { aiAnswered: false }), {
      action: 'person',
    });
  });

  it('does nothing once the caller has gone', () => {
    assert.deepEqual(
      afterAiLeg({ callerGone: true, handoff: { action: 'transfer' } }, { aiAnswered: true }),
      { action: 'none' },
    );
  });
});

describe('matching a spoken name', () => {
  const team = [{ name: 'Ravi Kumar' }, { name: 'Asha Nair' }, { name: 'Asha Verma' }];

  it('finds a full name or a unique first name', () => {
    assert.equal(matchPerson(team, 'ravi kumar')?.name, 'Ravi Kumar');
    assert.equal(matchPerson(team, 'Ravi')?.name, 'Ravi Kumar');
    assert.equal(matchPerson(team, 'nair')?.name, 'Asha Nair');
  });

  it('gives up on an ambiguous, unknown or empty name', () => {
    assert.equal(matchPerson(team, 'Asha'), null);
    assert.equal(matchPerson(team, 'Zed'), null);
    assert.equal(matchPerson(team, ''), null);
    assert.equal(matchPerson(team, undefined), null);
  });
});

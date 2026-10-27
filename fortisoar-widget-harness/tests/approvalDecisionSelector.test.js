'use strict';
// respondApprovals must click BOTH staged-mutation routes, not just the
// approval_request gate. The GA rehearsal (#21) stalled because the live
// driver answered only `approval-approve` and left a staged isolate/block
// ACTION card ("Confirm & Execute", data-testid `action-confirm-<id>`)
// un-executed, so the containment arc never finished unattended.
//
// This pins the decision -> selector mapping the driver uses. A regression to
// an approval-only selector (the old bug) turns these red.

const { approvalDecisionSelector } = require('../lib/chatSession');

describe('approvalDecisionSelector (respondApprovals target)', () => {
  test('approve matches the approval gate AND an action card Confirm button', () => {
    const sel = approvalDecisionSelector('approve');
    expect(sel).toContain('[data-testid="approval-approve"]');
    expect(sel).toContain('[data-testid^="action-confirm-"]');
    expect(sel).not.toContain('action-cancel-'); // approve never cancels
  });

  test('reject matches the approval gate AND an action card Cancel button', () => {
    const sel = approvalDecisionSelector('reject');
    expect(sel).toContain('[data-testid="approval-reject"]');
    expect(sel).toContain('[data-testid^="action-cancel-"]');
    expect(sel).not.toContain('action-confirm-'); // reject never confirms
  });

  test('both routes are a single, comma-joined querySelectorAll selector', () => {
    // page.$$ takes one selector; the two routes must be OR-ed, not separate.
    expect(approvalDecisionSelector('approve').split(',').length).toBe(2);
  });
});

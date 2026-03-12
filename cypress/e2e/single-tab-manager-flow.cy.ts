/**
 * E2E flow test for SingleTabManager (via the takeover strategy page).
 *
 * Verifies:
 * - First tab becomes active.
 * - Second tab opens while first is active → starts blocked.
 * - Second tab stays blocked until user clicks the "Take Over Control" button.
 * - After takeover, only the second tab is active (localStorage owner changes).
 */

describe('SingleTabManager - one active tab with takeover', () => {
  const TEST_KEY = 'single-active-tab';
  const PAGE = '/cypress-test-page.html?strategy=takeover&heartbeat=2000';

  it('keeps second tab blocked until user triggers takeover', () => {
    // ----- Tab 1: open app and become active -----
    cy.visit(PAGE);
    cy.contains('Start Manager').click();

    cy.get('#status').should('have.class', 'active').and('contain', 'Active Tab');

    // Capture tab 1 state from localStorage
    let firstTabId: string | null = null;
    cy.window().then((win) => {
      const raw = win.localStorage.getItem(TEST_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      firstTabId = parsed?.id ?? null;
      expect(firstTabId).to.be.a('string');
    });

    // ----- "Tab 2": open same page again in same Cypress browser -----
    // LocalStorage still contains first tab's state, so this new "tab" should be blocked.
    cy.visit(PAGE);
    cy.contains('Start Manager').click();

    // Second "tab" (new manager instance) should start in blocked state
    cy.get('#status').should('have.class', 'blocked').and('contain', 'Blocked');
    cy.get('#btn-takeover').should('not.be.disabled');

    // And from the manager's perspective in this tab, isActive() must be false
    cy.window().then((win: any) => {
      const manager = win.getManager?.();
      expect(manager).to.exist;
      if (!manager) return;
      expect(manager.isActive()).to.equal(false);
    });

    // Wait a bit to assert it doesn't auto-takeover while first tab is still considered alive
    cy.wait(2500);
    cy.get('#status').should('have.class', 'blocked');

    // ----- User explicitly triggers takeover on second tab -----
    cy.contains('🚀 Take Over Control').click();

    // Now second tab should be active, and takeover button disabled
    cy.get('#status').should('have.class', 'active').and('contain', 'Active Tab');
    cy.get('#btn-takeover').should('be.disabled');

    // LocalStorage owner should now be different from the first tab's ID
    cy.window().then((win) => {
      const raw = win.localStorage.getItem(TEST_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      expect(parsed).to.not.be.null;
      if (!parsed) return;
      if (firstTabId) {
        expect(parsed.id).to.not.equal(firstTabId);
      }
    });
  });
});


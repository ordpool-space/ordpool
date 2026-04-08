const baseModule = Cypress.env('BASE_MODULE');

describe('Recent Transactions Page', () => {
  if (baseModule === 'mempool') {

    it('updates the transaction list over time', () => {
      cy.visit('/txs');
      cy.waitForSkeletonGone();

      cy.get('[data-cy="transactions-list"] tr').should('have.length.greaterThan', 0);

      cy.get('[data-cy="transactions-list"] tr .table-cell-txid a').then(($rows) => {
        const initialTxids = [...$rows].map((el) => el.textContent.trim());

        cy.wait(15000);

        cy.get('[data-cy="transactions-list"] tr .table-cell-txid a').then(($updatedRows) => {
          const updatedTxids = [...$updatedRows].map((el) => el.textContent.trim());
          expect(updatedTxids).to.not.deep.equal(initialTxids);
        });
      });
    });

    it('pauses updates when clicking the pause icon', () => {
      cy.visit('/txs');
      cy.waitForSkeletonGone();

      cy.get('[data-cy="transactions-list"] tr').should('have.length.greaterThan', 0);

      cy.get('[data-cy="btn-pause"]').click();

      cy.get('[data-cy="transactions-list"] tr .table-cell-txid a').then(($rows) => {
        const pausedTxids = [...$rows].map((el) => el.textContent.trim());

        cy.wait(10000);

        cy.get('[data-cy="transactions-list"] tr .table-cell-txid a').then(($updatedRows) => {
          const updatedTxids = [...$updatedRows].map((el) => el.textContent.trim());
          expect(updatedTxids).to.deep.equal(pausedTxids);
        });
      });
    });

    it('caps the list when changing the limit to 10', () => {
      cy.visit('/txs');

      cy.get('[data-cy="transactions-list"] tr').should('have.length.greaterThan', 0);
      cy.get('[data-cy="transactions-list"] tr', { timeout: 90000 }).should('have.length', 50);
      cy.get('[data-cy="limit-10"]').click();
      cy.scrollTo('top');
      cy.get('[data-cy="transactions-list"] tr', { timeout: 90000 }).should('have.length', 10);
    });

    it('shows the new transaction pill when there are new transactions', () => {
      cy.visit('/txs');

      cy.get('[data-cy="transactions-list"] tr').should('have.length.greaterThan', 0);
      cy.scrollTo('bottom');
      cy.get('[data-cy="new-tx-pill"]').should('be.visible');
    });

    it('shows the new transaction pill when there are new transactions and scrolls to the top when clicked', () => {
      cy.visit('/txs');

      cy.get('[data-cy="transactions-list"] tr').should('have.length.greaterThan', 0);
      cy.scrollTo('bottom');
      cy.get('[data-cy="new-tx-pill"]', {timeout: 10000}).should('be.visible');
      cy.get('[data-cy="new-tx-pill"]').click();
      cy.wait(1000);
      cy.window().then((win) => {
        expect(win.scrollY).to.be.eq(0);
      });
    });
  }
});

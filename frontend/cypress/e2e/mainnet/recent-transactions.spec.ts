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

    it('pauses updates when clicking the clock icon', () => {
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
      cy.waitForSkeletonGone();

      cy.get('[data-cy="transactions-list"] tr').should('have.length.greaterThan', 0);

      // Wait for the list to accumulate transactions
      cy.get('[data-cy="transactions-list"] tr', { timeout: 30000 }).should('have.length.greaterThan', 10);

      cy.get('[data-cy="limit-10"]').click();

      cy.get('[data-cy="transactions-list"] tr').should('have.length.at.most', 10);
    });

  }
});

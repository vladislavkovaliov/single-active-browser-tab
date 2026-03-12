import { defineConfig } from 'cypress';

export default defineConfig({
  // Safer default: app code cannot read Cypress.env()
  allowCypressEnv: false,

  e2e: {
    baseUrl: 'http://localhost:5173',
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.{ts,tsx}',
    viewportWidth: 1280,
    viewportHeight: 720,
    setupNodeEvents(on, config) {
      // implement node event listeners here if needed
      return config;
    },
  },

  // Disable Chrome web security for cross-tab / localStorage scenarios
  chromeWebSecurity: false,
});

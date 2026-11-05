const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

/** Runs `fn` with `actor` available to any Sequelize hook invoked during it. */
function runWithActor(actor, fn) {
  return als.run({ actor }, fn);
}

/** The human-readable identity of whoever is making the current request, for audit columns. */
function getCurrentActor() {
  return als.getStore()?.actor || 'SYSTEM';
}

module.exports = { runWithActor, getCurrentActor };

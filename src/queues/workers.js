const { Worker } = require('bullmq');
const { connection } = require('./connection');

const setupWorkers = () => {
  if (process.env.DISABLE_REDIS === 'true' || !process.env.REDIS_URL) {
    console.log('BullMQ Workers disabled. Skipping worker initialization.');
    return;
  }

  const communicationsWorker = new Worker('communications', async (job) => {
    console.log(`[Worker] Communication job ${job.id} skipped per admin directive (automated messaging disabled).`);
  }, { connection });

  const remindersWorker = new Worker('reminders', async (job) => {
    console.log(`[Worker] Reminder job ${job.id} skipped per admin directive (automated messaging disabled).`);
  }, { connection });

  const noShowEnforcerWorker = new Worker('no-show-enforcer', async (job) => {
    console.log(`[Worker] No-show-enforcer job ${job.id} skipped per admin directive.`);
  }, { connection });

  const paymentDripWorker = new Worker('payment-drip', async (job) => {
    console.log(`[Worker] Payment-drip job ${job.id} skipped per admin directive.`);
  }, { connection });

  console.log('BullMQ Workers initialized (Automated outbound messaging disabled).');
};

module.exports = { setupWorkers };

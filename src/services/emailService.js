// Email service completely disabled and wiped per admin directive.
// No emails will be generated or sent by the application.

const dummyEmailFn = async () => {
  console.log('[Email Service] Outbound email suppressed (Email service deleted per admin directive).');
  return { success: true, messageId: 'disabled', dryRun: true };
};

module.exports = new Proxy({
  sendEmail: dummyEmailFn,
  sendAppointmentConfirmationEmail: dummyEmailFn,
  sendMeetingRescheduledEmail: dummyEmailFn,
  sendMeetingCancelledEmail: dummyEmailFn,
  sendInvoiceEmail: dummyEmailFn,
  sendPaymentSuccessEmail: dummyEmailFn,
  sendDocumentVerificationEmail: dummyEmailFn,
}, {
  get: (target, prop) => {
    if (prop in target) return target[prop];
    return dummyEmailFn;
  }
});

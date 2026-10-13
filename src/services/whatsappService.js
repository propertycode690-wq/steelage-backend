const twilio = require('twilio');
const prisma = require('../config/db');

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;

const isConfigured = !!(
  TWILIO_ACCOUNT_SID &&
  TWILIO_ACCOUNT_SID.startsWith('AC') &&
  TWILIO_AUTH_TOKEN &&
  TWILIO_AUTH_TOKEN !== 'your_twilio_auth_token_here' &&
  TWILIO_WHATSAPP_FROM
);

/**
 * Utility function to clean and normalize international phone numbers.
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return null;
  let clean = String(phone).trim();
  if (clean.startsWith('whatsapp:')) {
    clean = clean.substring(9);
  }
  clean = clean.replace(/[^\d+]/g, '');
  if (clean.startsWith('00')) {
    clean = '+' + clean.substring(2);
  }
  if (!clean.startsWith('+')) {
    if (clean.startsWith('0')) {
      clean = clean.substring(1);
    }
    clean = '+971' + clean;
  }
  return clean;
};

/**
 * Single auto-greeting message for inbound WhatsApp queries from Steelage Construction Ltd.
 */
const sendSteelageGreeting = async (toPhone, senderName = 'Valued Client') => {
  const greetingText = `Hello ${senderName}! 👋\n\nWelcome to *Steelage Construction Ltd*. 🏗️\n\nThank you for reaching out to us regarding your commercial contracting & construction inquiry. Our team has received your message and will respond to you shortly!`;

  if (!isConfigured) {
    console.log(`[WhatsApp Greeting Simulation to ${toPhone}]:\n${greetingText}`);
    return { success: true, dryRun: true };
  }

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const formattedTo = formatPhoneNumber(toPhone);
    const response = await client.messages.create({
      from: TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? TWILIO_WHATSAPP_FROM : `whatsapp:${TWILIO_WHATSAPP_FROM}`,
      to: `whatsapp:${formattedTo}`,
      body: greetingText
    });
    console.log(`[WhatsApp Greeting Sent to ${toPhone}] SID: ${response.sid}`);
    return { success: true, messageSid: response.sid };
  } catch (err) {
    console.error(`[WhatsApp Greeting Error to ${toPhone}]:`, err.message);
    return { success: false, error: err.message };
  }
};

const dummyWhatsAppFn = async () => {
  return { success: true, message: 'Automated WhatsApp template suppressed.' };
};

const whatsappServiceModule = {
  formatPhoneNumber,
  isConfigured: () => isConfigured,
  sendSteelageGreeting,
  sendCustomWhatsApp: async (toPhone, text) => sendSteelageGreeting(toPhone),
  sendWhatsAppMessage: async (options) => {
    if (options && (options.to || options.phone)) {
      return sendSteelageGreeting(options.to || options.phone);
    }
    return dummyWhatsAppFn();
  }
};

module.exports = new Proxy(whatsappServiceModule, {
  get: (target, prop) => {
    if (prop in target) return target[prop];
    return dummyWhatsAppFn;
  }
});

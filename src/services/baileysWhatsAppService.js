const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/db');

const logger = pino({ level: 'silent' });
const AUTH_FOLDER = path.join(__dirname, '../../uploads/baileys_auth');

if (!fs.existsSync(AUTH_FOLDER)) {
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}

let sock = null;
let currentPairingCode = null;
let connectionState = {
  isConnected: false,
  phoneNumber: null,
  lastConnectedAt: null,
  qr: null
};
let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

function normalizePhoneNumber(phone) {
  if (!phone) return '';
  let clean = String(phone).trim().replace(/[^\d]/g, '');
  if (clean.startsWith('00')) clean = clean.substring(2);
  return clean;
}

/**
 * Robust helper to extract text from all types of WhatsApp message envelopes
 */
function extractMessageContent(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption || '[Image]';
  if (message.videoMessage?.caption) return message.videoMessage.caption || '[Video]';
  if (message.documentMessage?.caption) return message.documentMessage.caption || '[Document]';
  if (message.audioMessage) return '[Voice Note]';
  if (message.contactMessage) return `[Contact: ${message.contactMessage.displayName || 'Card'}]`;
  if (message.locationMessage) return '[Location Shared]';

  // Unpack nested wrappers (ephemeral, viewOnce, etc.)
  if (message.ephemeralMessage?.message) return extractMessageContent(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message) return extractMessageContent(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message) return extractMessageContent(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message) return extractMessageContent(message.viewOnceMessageV2Extension.message);
  if (message.documentWithCaptionMessage?.message) return extractMessageContent(message.documentWithCaptionMessage.message);

  return '';
}

/**
 * Initialize Baileys WhatsApp Socket
 */
async function initBaileys(forceNew = false) {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    console.log(`[Baileys] Initializing WhatsApp Gateway v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: false,
      auth: state,
      browser: ['Steelage CRM', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: true,
      defaultQueryTimeoutMs: 60000,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        connectionState.qr = qr;
        if (ioInstance) {
          ioInstance.emit('whatsapp:qr', { qr });
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[Baileys] Connection closed (code: ${statusCode}). Reconnecting: ${shouldReconnect}`);

        connectionState.isConnected = false;
        connectionState.qr = null;
        if (ioInstance) {
          ioInstance.emit('whatsapp:status', { isConnected: false });
        }

        if (shouldReconnect) {
          setTimeout(() => initBaileys(), 4000);
        } else {
          console.log('[Baileys] Device logged out. Resetting session directory.');
          try {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            fs.mkdirSync(AUTH_FOLDER, { recursive: true });
          } catch (e) {
            console.error('[Baileys] Session cleanup error:', e.message);
          }
        }
      } else if (connection === 'open') {
        const rawJid = sock.user?.id || sock.authState?.creds?.me?.id || '';
        const userPhone = rawJid.split(':')[0] || rawJid.split('@')[0];
        console.log(`[Baileys] ✅ WhatsApp is LIVE & CONNECTED! Account: +${userPhone}`);

        connectionState.isConnected = true;
        connectionState.phoneNumber = userPhone;
        connectionState.lastConnectedAt = new Date();
        connectionState.qr = null;
        currentPairingCode = null;

        if (ioInstance) {
          ioInstance.emit('whatsapp:status', {
            isConnected: true,
            phoneNumber: userPhone
          });
        }
      }
    });

    // Handle Incoming & Outbound Message Upserts
    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!messages || !Array.isArray(messages)) return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@newsletter') || remoteJid.includes('@broadcast') || remoteJid === 'status@broadcast') {
          // Skip group chats, WhatsApp channels/newsletters, and status stories
          continue;
        }

        const senderPhone = remoteJid.replace('@s.whatsapp.net', '').replace(/:\d+/, '');
        const senderPushName = msg.pushName || 'WhatsApp Contact';
        const messageText = extractMessageContent(msg.message);

        if (!messageText) continue;

        const formattedPhone = `+${senderPhone}`;
        const isFromMe = !!msg.key.fromMe;

        console.log(`[Baileys Message] ${isFromMe ? 'OUTBOUND' : 'INBOUND'} ${formattedPhone} (${senderPushName}): "${messageText}"`);

        try {
          // 1. Check if Client or Lead exists
          const existingClient = await prisma.client.findFirst({
            where: {
              OR: [
                { phone: formattedPhone },
                { phone: senderPhone },
                { phone: { contains: senderPhone.slice(-8) } }
              ]
            }
          });

          let leadId = null;
          let clientId = existingClient ? existingClient.id : null;

          if (!existingClient && !isFromMe) {
            let existingLead = await prisma.lead.findFirst({
              where: {
                OR: [
                  { phone: formattedPhone },
                  { phone: senderPhone },
                  { phone: { contains: senderPhone.slice(-8) } }
                ]
              }
            });

            if (!existingLead) {
              const nameParts = senderPushName.trim().split(' ');
              const fName = nameParts[0] || 'WhatsApp';
              const lName = nameParts.slice(1).join(' ') || 'User';

              existingLead = await prisma.lead.create({
                data: {
                  firstName: fName,
                  lastName: lName,
                  email: `${senderPhone}@whatsapp.lead`,
                  phone: formattedPhone,
                  source: 'WhatsApp',
                  status: 'New Lead',
                  serviceType: 'Construction & Contracting',
                  notes: `Captured from WhatsApp message: "${messageText}"`
                }
              });

              if (ioInstance) {
                ioInstance.emit('new_lead', existingLead);
              }
            }
            leadId = existingLead.id;
          }

          // 2. Save message to CommunicationLog
          const commLog = await prisma.communicationLog.create({
            data: {
              clientId: clientId,
              phone: formattedPhone,
              name: isFromMe ? 'Agent' : senderPushName,
              channel: 'WHATSAPP',
              direction: isFromMe ? 'OUTBOUND' : 'INBOUND',
              content: messageText,
              deliveryStatus: isFromMe ? 'SENT' : 'DELIVERED',
              messageId: msg.key.id
            }
          });

          // 3. Emit live socket event to CRM Social Inbox
          if (ioInstance) {
            ioInstance.emit('new_whatsapp_message', {
              phone: formattedPhone,
              name: isFromMe ? 'Agent' : senderPushName,
              text: messageText,
              rawTimestamp: commLog.createdAt,
              timestamp: `${new Date(commLog.createdAt).toLocaleDateString('en-GB')} • ${new Date(commLog.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
              sender: isFromMe ? 'agent' : 'customer'
            });
          }

          // 4. Send Automatic Greeting / Welcome Reply (Only for Inbound)
          if (!isFromMe) {
            const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
            const recentOutbound = await prisma.communicationLog.findFirst({
              where: {
                phone: formattedPhone,
                direction: 'OUTBOUND',
                createdAt: { gte: threeHoursAgo }
              }
            });

            if (!recentOutbound) {
              await delay(1200); // 1.2s human typing delay
              const greeting = `Hello ${senderPushName}! 👋\n\nWelcome to *Steelage Construction Ltd*. 🏗️\n\nThank you for reaching out regarding our commercial contracting & construction services. Our team has received your inquiry and an executive will assist you shortly!\n\nFor immediate assistance, please reply with your project location and requirements.`;

              await sock.sendMessage(remoteJid, { text: greeting });

              const outboundLog = await prisma.communicationLog.create({
                data: {
                  clientId: clientId,
                  phone: formattedPhone,
                  name: 'Steelage Auto-Bot',
                  channel: 'WHATSAPP',
                  direction: 'OUTBOUND',
                  content: greeting,
                  deliveryStatus: 'SENT'
                }
              });

              if (ioInstance) {
                ioInstance.emit('new_whatsapp_message', {
                  phone: formattedPhone,
                  name: 'Steelage Auto-Bot',
                  text: greeting,
                  rawTimestamp: outboundLog.createdAt,
                  timestamp: `${new Date(outboundLog.createdAt).toLocaleDateString('en-GB')} • ${new Date(outboundLog.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                  sender: 'agent',
                  respondedBy: { name: 'Steelage Auto-Bot', role: 'Automation' }
                });
              }
              console.log(`[Baileys Auto-Reply Sent] To: ${formattedPhone}`);
            }
          }
        } catch (dbErr) {
          console.error('[Baileys DB Handling Error]:', dbErr.message);
        }
      }
    });

  } catch (err) {
    console.error('[Baileys Initialization Error]:', err.message);
  }
}

/**
 * Request 8-Digit Pairing Code for a given phone number
 */
async function generatePairingCode(rawPhoneNumber) {
  const cleanPhone = normalizePhoneNumber(rawPhoneNumber);
  if (!cleanPhone || cleanPhone.length < 8) {
    throw new Error('Please provide a valid international phone number with country code (e.g. 16043353700)');
  }

  if (!sock || !sock.authState) {
    await initBaileys();
    await delay(1500);
  }

  if (sock?.authState?.creds?.registered) {
    return {
      success: true,
      alreadyConnected: true,
      message: 'WhatsApp account is already registered and connected.'
    };
  }

  try {
    const code = await sock.requestPairingCode(cleanPhone);
    const formattedCode = code ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    currentPairingCode = formattedCode;
    console.log(`[Baileys] 🔑 Pairing Code generated for +${cleanPhone}: ${formattedCode}`);

    return {
      success: true,
      pairingCode: formattedCode,
      rawCode: code,
      phoneNumber: `+${cleanPhone}`,
      expiresIn: '60 seconds',
      instructions: [
        '1. Open WhatsApp on your phone.',
        '2. Go to Settings > Linked Devices > Link a Device.',
        '3. Tap "Link with phone number instead" at the bottom.',
        `4. Enter this 8-digit code: ${formattedCode}`
      ]
    };
  } catch (err) {
    console.error('[Baileys Pairing Code Error]:', err.message);
    throw new Error(`Failed to generate pairing code: ${err.message}`);
  }
}

/**
 * Send an outbound message via Baileys WhatsApp client
 */
async function sendMessage(toPhone, text, mediaUrl = null) {
  if (!sock || !connectionState.isConnected) {
    return {
      success: false,
      error: 'WhatsApp client is not currently connected. Please link device first.'
    };
  }

  const raw = String(toPhone || '').trim().replace(/^\+/, '');
  let jid;
  if (raw.endsWith('@lid') || raw.endsWith('@s.whatsapp.net')) {
    jid = raw;
  } else if (raw.includes('@')) {
    jid = raw;
  } else {
    const cleanPhone = normalizePhoneNumber(raw);
    jid = `${cleanPhone}@s.whatsapp.net`;
  }

  try {
    let result;
    if (mediaUrl) {
      result = await sock.sendMessage(jid, {
        image: { url: mediaUrl },
        caption: text || ''
      });
    } else {
      result = await sock.sendMessage(jid, { text: text || '' });
    }

    console.log(`[Baileys Outbound Success] Delivered to ${jid}: "${text}"`);
    return {
      success: true,
      messageId: result?.key?.id
    };
  } catch (err) {
    console.error(`[Baileys Send Error to ${jid}]:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Get current connection status
 */
function getStatus() {
  return {
    isConnected: !!connectionState.isConnected,
    phoneNumber: connectionState.phoneNumber,
    lastConnectedAt: connectionState.lastConnectedAt,
    qr: connectionState.qr,
    pairingCode: currentPairingCode,
    isRegistered: !!connectionState.isConnected
  };
}

/**
 * Disconnect / Logout & Wipe Session
 */
async function disconnect() {
  try {
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        try { sock.end(); } catch (e2) {}
      }
    }
  } catch (err) {
    console.log('[Baileys] Socket logout warning:', err.message);
  }

  sock = null;
  connectionState = {
    isConnected: false,
    phoneNumber: null,
    lastConnectedAt: null,
    qr: null
  };
  currentPairingCode = null;

  try {
    if (fs.existsSync(AUTH_FOLDER)) {
      fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    }
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
  } catch (e) {
    console.error('[Baileys] Error wiping auth folder:', e.message);
  }

  if (ioInstance) {
    ioInstance.emit('whatsapp:status', { isConnected: false });
  }

  // Re-initialize clean Baileys socket for fresh QR code
  setTimeout(() => {
    initBaileys().catch(e => console.log('[Baileys] Re-init warning:', e.message));
  }, 1000);

  return { success: true, message: 'Disconnected and cleared session.' };
}

module.exports = {
  initBaileys,
  setIo,
  generatePairingCode,
  sendMessage,
  getStatus,
  disconnect,
  normalizePhoneNumber
};

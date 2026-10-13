const express = require('express');
const router = express.Router();
const baileysService = require('../services/baileysWhatsAppService');
const { authMiddleware, rbacMiddleware } = require('../middlewares/authMiddleware');
const prisma = require('../config/db');

/**
 * Generate 8-Digit Pairing Code for a client phone number
 * e.g. POST /api/v1/whatsapp/pair-code { phone: "16043353700" }
 */
router.post('/pair-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required (e.g. 16043353700 or +16043353700)' });
    }

    const result = await baileysService.generatePairingCode(phone);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error generating WhatsApp pairing code:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Check WhatsApp connection status
 * GET /api/v1/whatsapp/status
 */
router.get('/status', (req, res) => {
  try {
    const status = baileysService.getStatus();
    return res.status(200).json({ success: true, ...status });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Send an Outbound WhatsApp Message via linked device
 * POST /api/v1/whatsapp/send
 */
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { phone, text, mediaUrl, clientId } = req.body;
    if (!phone || (!text && !mediaUrl)) {
      return res.status(400).json({ success: false, message: 'Phone and text/media are required.' });
    }

    const result = await baileysService.sendMessage(phone, text, mediaUrl);
    if (!result.success) {
      return res.status(400).json(result);
    }

    const staffUserId = req.user?.id || null;
    const staffName = req.user?.fullName || 'Agent';

    const cleanPh = baileysService.normalizePhoneNumber(phone);
    const formattedPhone = `+${cleanPh}`;

    // Log to DB
    const log = await prisma.communicationLog.create({
      data: {
        clientId: clientId || null,
        phone: formattedPhone,
        name: staffName,
        respondedByUserId: staffUserId,
        channel: 'WHATSAPP',
        direction: 'OUTBOUND',
        content: text || (mediaUrl ? `[FILE: ${mediaUrl}]` : ''),
        deliveryStatus: 'SENT',
        messageId: result.messageId
      },
      include: {
        respondedByUser: {
          select: { id: true, fullName: true, role: true, avatar: true }
        }
      }
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('new_whatsapp_message', {
        phone: formattedPhone,
        name: staffName,
        text: text,
        rawTimestamp: log.createdAt,
        timestamp: `${new Date(log.createdAt).toLocaleDateString('en-GB')} • ${new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        sender: 'agent',
        respondedBy: {
          id: req.user?.id,
          name: staffName,
          role: req.user?.role
        }
      });
    }

    return res.status(200).json({ success: true, log });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * Disconnect / Unlink WhatsApp device
 * POST /api/v1/whatsapp/disconnect
 */
router.post('/disconnect', async (req, res) => {
  try {
    const result = await baileysService.disconnect();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;

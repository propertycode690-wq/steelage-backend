require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Setup Socket.io
const io = new Server(server, {
  cors: {
    origin: "*", // Or specify frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Expose io to routes if needed
app.set('io', io);

io.on('connection', (socket) => {
  console.log(`User connected to socket: ${socket.id}`);

  // When a user logs in, they send their role to join a specific room
  socket.on('join-role', (role) => {
    const roomName = `role:${role}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} joined room ${roomName}`);
  });

  // When a user logs in, they also join their individual user room
  socket.on('join-user', (userId) => {
    const roomName = `user:${userId}`;
    socket.join(roomName);
    console.log(`Socket ${socket.id} joined room ${roomName}`);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected from socket: ${socket.id}`);
  });
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Origin', 'X-com-zoho-invoice-organizationid']
}));
app.use(morgan('dev'));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api/v1/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Setup Basic Route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'AAA Consultancy Backend is running.' });
});

// Mount Routes
app.use('/api/v1/auth', require('./routes/authRoutes'));
app.use('/api/v1/users', require('./routes/userRoutes'));
app.use('/api/v1/settings', require('./routes/settingsRoutes'));
app.use('/api/v1/leads', require('./routes/leadRoutes'));
app.use('/api/v1/clients', require('./routes/clientRoutes'));
app.use('/api/v1/cases', require('./routes/caseRoutes'));
app.use('/api/v1/consultations', require('./routes/consultationRoutes'));
app.use('/api/v1/payments', require('./routes/paymentRoutes'));
app.use('/api/v1/documents', require('./routes/documentRoutes'));
app.use('/api/v1/marketing', require('./routes/marketingRoutes'));
app.use('/api/v1/webhooks', require('./routes/webhookRoutes'));
app.use('/api/v1/booking', require('./routes/bookingRoutes'));
app.use('/api/v1/ai', require('./routes/aiRoutes'));
app.use('/api/v1/notifications', require('./routes/notificationRoutes'));
app.use('/api/v1/audit-logs', require('./routes/auditLogRoutes'));
app.use('/api/v1/social', require('./routes/socialRoutes'));
app.use('/api/v1/communications', require('./routes/communicationRoutes'));
app.use('/api/v1/coupons', require('./routes/couponRoutes'));
app.use('/api/v1/templates', require('./routes/templateRoutes'));
app.use('/api/templates', require('./routes/templateRoutes'));
app.use('/api/v1/whatsapp', require('./routes/whatsappRoutes'));

// Initialize WhatsApp Baileys Service
const baileysService = require('./services/baileysWhatsAppService');
baileysService.setIo(io);
baileysService.initBaileys().catch(err => console.log('[Baileys Init Warning]:', err.message));

// Start Server
const PORT = Number(process.env.PORT) || 5000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[Server Error] Port ${PORT} is already in use.`);
    process.exit(1);
  } else {
    console.error('[Server Error]', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (bound to 0.0.0.0)`);
});

// Initialize BullMQ Workers safely
try {
  const { setupWorkers } = require('./queues/workers');
  setupWorkers();
} catch (err) {
  console.error('[Worker Setup Error]', err.message);
}

// Automatic email/WhatsApp schedulers removed per admin requirements.
// WhatsApp Multi-Device Gateway active & monitored.

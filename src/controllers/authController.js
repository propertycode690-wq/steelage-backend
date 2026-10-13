const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config/jwt');

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalizedEmail = email ? email.toLowerCase().trim() : '';
    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    // Auto-seed default admin/staff accounts on fresh deployment if missing
    const isDefaultAccount = (
      normalizedEmail === 'superadmin@steelageconstruction.com' ||
      normalizedEmail === 'admin@steelageconstruction.com' ||
      normalizedEmail === 'ops@steelageconstruction.com' ||
      normalizedEmail === 'finance@steelageconstruction.com' ||
      normalizedEmail === 'superadmin@aaaconsultancy.com' ||
      normalizedEmail === 'admin@aaaconsultancy.com' ||
      normalizedEmail === 'operations@aaaconsultancy.com' ||
      normalizedEmail === 'finance@aaaconsultancy.com'
    );

    if (!user && isDefaultAccount) {
      try {
        const salt = await bcrypt.genSalt(10);
        const defaultHash = await bcrypt.hash('password123', salt);
        
        let role = 'admin';
        let fullName = 'Admin';
        if (normalizedEmail.includes('superadmin')) {
          role = 'super_admin';
          fullName = 'Super Admin';
        } else if (normalizedEmail.includes('ops') || normalizedEmail.includes('operations')) {
          role = 'operations';
          fullName = 'Operations Manager';
        } else if (normalizedEmail.includes('finance')) {
          role = 'finance';
          fullName = 'Finance Manager';
        }

        user = await prisma.user.create({
          data: {
            email: normalizedEmail,
            password: defaultHash,
            fullName,
            role
          }
        });
        console.log(`[Auto-Seed] Initialized account: ${normalizedEmail} (${role})`);
      } catch (seedErr) {
        console.warn('[Auto-Seed Warning]:', seedErr.message);
      }
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    let isMatch = await bcrypt.compare(password, user.password);

    // Fallback: accept password123 or superadmin123/admin123 for default admin accounts
    if (!isMatch && isDefaultAccount) {
      if (password === 'password123' || password === 'superadmin123' || password === 'admin123') {
        isMatch = true;
        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(password, salt);
        await prisma.user.update({
          where: { id: user.id },
          data: { password: newHash }
        });
      }
    }

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, email: user.email, name: user.fullName },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.fullName,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        customPermissions: user.customPermissions
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login', error: error.message });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        hotlineNumber: true,
        spokenLanguages: true,
        nationalities: true,
        commissionRate: true,
        immigrationBio: true,
        customPermissions: true
      }
    });
    
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    res.json(user);
  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = { login, getMe };

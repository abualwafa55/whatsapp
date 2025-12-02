const { PrismaClient } = require('@prisma/client');

let prisma = global.__prisma__; // cache in dev to prevent multiple instances

if (!prisma) {
  prisma = new PrismaClient();
  if (process.env.NODE_ENV !== 'production') {
    global.__prisma__ = prisma;
  }
}

module.exports = prisma;

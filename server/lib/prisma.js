const { PrismaClient } = require('@prisma/client');

const globalRef = globalThis;
const prisma = globalRef._prisma || new PrismaClient({ log: ['error', 'warn'] });
if (process.env.NODE_ENV !== 'production') globalRef._prisma = prisma;

module.exports = prisma;

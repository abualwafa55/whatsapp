const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@admin.com';
  const password = '123456789';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: hashedPassword,
      role: UserRole.ADMIN,
      isActive: true
    },
    create: {
      email,
      passwordHash: hashedPassword,
      role: UserRole.ADMIN,
      createdBy: 'system'
    }
  });

  console.log('Seeded admin user:', { email: user.email, role: user.role });
}

main()
  .catch((error) => {
    console.error('Error running seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Idempotent seed. Safe to run on every deploy.
// Creates the default admin (from env vars) if missing,
// seeds 100 real ICC donors, and adds a few sample prospects.
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  // --- Admin user ---
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPass = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPass) {
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existing) {
      const passwordHash = await bcrypt.hash(adminPass, 12);
      await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          name: 'ICC Admin',
          role: 'admin',
        },
      });
      console.log(`[seed] Created admin user ${adminEmail}`);
    } else {
      console.log(`[seed] Admin ${adminEmail} already exists, skipping`);
    }
  } else {
    console.warn('[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping admin creation');
  }

  // --- Donors ---
  const donorsPath = path.join(__dirname, 'donors_seed.json');
  if (fs.existsSync(donorsPath)) {
    const donors = JSON.parse(fs.readFileSync(donorsPath, 'utf-8'));
    let created = 0;
    let skipped = 0;
    for (const d of donors) {
      const existing = await prisma.donor.findUnique({ where: { name: d.name } });
      if (existing) { skipped++; continue; }
      await prisma.donor.create({
        data: {
          name: d.name,
          type: d.type === 'individual' ? 'individual' : 'org',
          principals: Array.isArray(d.principals) ? d.principals : [],
          notes: d.notes || null,
        },
      });
      created++;
    }
    console.log(`[seed] Donors: ${created} created, ${skipped} already existed`);
  }

  // --- Sample prospects (only if there are no prospects yet) ---
  const prospectCount = await prisma.prospect.count();
  if (prospectCount === 0) {
    const samples = [
      {
        name: 'Sample: David Rosen',
        status: 'warm',
        tier: 1,
        age: 58,
        location: 'New York, NY',
        undergrad: 'Columbia University',
        grad: 'Harvard Business School',
        netWorth: '$450M',
        netWorthSource: 'Forbes (2024)',
        occupation: 'Founder & CEO, Rosen Capital Partners',
        previousRoles: ['Managing Director, Goldman Sachs', 'Board, Columbia Hillel'],
        campusConnections: ['Rosen Center for Jewish Life, Columbia', 'Trustee, Columbia University'],
        philanthropicFootprint: ['AIPAC', 'UJA-Federation NY', 'Birthright Israel'],
        oct7Signals: 'Signed Oct 2023 open letter demanding university action on campus antisemitism. Reduced annual giving to Columbia pending policy review.',
        children: 'Daughter at Penn, son at Brown',
        spouse: 'Sarah Rosen (board, UJA-Federation)',
        personalConnections: 'Close friends with Marcus Foundation principals',
        iccNetworkMatches: [],
        connectionDetail: '',
        contacted: false,
      },
      {
        name: 'Sample: Rebecca Goldberg-Stein',
        status: 'hot',
        tier: 1,
        age: 52,
        location: 'Boca Raton, FL',
        undergrad: 'University of Michigan',
        grad: 'NYU Law',
        netWorth: '$180M',
        netWorthSource: 'Family office disclosure',
        occupation: 'Managing Partner, Goldberg Stein Family Office',
        previousRoles: ['Partner, Paul Weiss', 'Board, Michigan Hillel'],
        campusConnections: ['Goldberg Jewish Student Center, University of Michigan'],
        philanthropicFootprint: ['Jewish Federation of South Palm Beach', 'Hillel International', 'ADL'],
        oct7Signals: 'Major public donor to Hillel campus security fund post-Oct 7. Quoted in WSJ about divestment pressure on alma mater.',
        children: 'Two children, both attend University of Florida',
        spouse: 'Jonathan Stein (CEO, Stein Industries)',
        personalConnections: 'Long-time associate of Adam Milstein',
        iccNetworkMatches: [],
        connectionDetail: '',
        contacted: false,
      },
      {
        name: 'Sample: Michael Abramowitz',
        status: 'cold',
        tier: 2,
        age: 64,
        location: 'Los Angeles, CA',
        undergrad: 'UCLA',
        grad: 'Stanford GSB',
        netWorth: '$95M',
        netWorthSource: 'Wealth-X estimate',
        occupation: 'Tech investor, former exec',
        previousRoles: ['SVP, Disney', 'Board, Jewish Federation Los Angeles'],
        campusConnections: [],
        philanthropicFootprint: ['Jewish Federation Los Angeles', 'Stanford GSB'],
        oct7Signals: '',
        children: '',
        spouse: '',
        personalConnections: '',
        iccNetworkMatches: [],
        connectionDetail: '',
        contacted: false,
      },
    ];

    for (const p of samples) {
      await prisma.prospect.create({ data: p });
    }
    console.log(`[seed] Prospects: ${samples.length} sample prospects created`);
  } else {
    console.log(`[seed] Prospects already present (${prospectCount}), skipping samples`);
  }
}

main()
  .catch((e) => {
    console.error('[seed] Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

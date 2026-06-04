// GET /api/network/graph — returns prefixed nodes + edges for the Connection Map.
// Isolated nodes (donors with no connected prospects, prospects whose matches
// resolve to no known donors) are filtered out.

const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/network/graph', async (req, res) => {
  try {
    const [donors, prospects] = await Promise.all([
      prisma.donor.findMany({
        select: { id: true, name: true, type: true },
        orderBy: { name: 'asc' },
      }),
      prisma.prospect.findMany({
        where: { iccNetworkMatches: { isEmpty: false } },
        select: { id: true, name: true, status: true, iccNetworkMatches: true, connectionDetail: true },
      }),
    ]);

    const donorById = new Map(donors.map((d) => [d.id, d]));
    const connectedDonorIds = new Set();
    const edges = [];

    for (const p of prospects) {
      const validDonorIds = (p.iccNetworkMatches || []).filter((id) => donorById.has(id));
      if (validDonorIds.length === 0) continue;
      for (const did of validDonorIds) {
        connectedDonorIds.add(did);
        edges.push({
          source: `donor_${did}`,
          target: `prospect_${p.id}`,
          detail: '',
        });
      }
    }

    // Count prospects connected per donor
    const prospectCountByDonor = {};
    for (const e of edges) {
      const donorPrefixedId = e.source;
      prospectCountByDonor[donorPrefixedId] = (prospectCountByDonor[donorPrefixedId] || 0) + 1;
    }

    const donorNodes = donors
      .filter((d) => connectedDonorIds.has(d.id))
      .map((d) => ({
        id: `donor_${d.id}`,
        rawId: d.id,
        label: d.name,
        type: 'donor',
        prospectCount: prospectCountByDonor[`donor_${d.id}`] || 0,
      }));

    const prospectNodes = prospects
      .filter((p) => (p.iccNetworkMatches || []).some((id) => donorById.has(id)))
      .map((p) => ({
        id: `prospect_${p.id}`,
        rawId: p.id,
        label: p.name,
        type: 'prospect',
        status: p.status,
      }));

    res.json({
      nodes: [...donorNodes, ...prospectNodes],
      edges,
      counts: {
        donors: donorNodes.length,
        prospects: prospectNodes.length,
        connections: edges.length,
      },
    });
  } catch (e) {
    console.error('[network/graph]', e);
    res.status(500).json({ error: 'Failed to build network graph' });
  }
});

module.exports = router;

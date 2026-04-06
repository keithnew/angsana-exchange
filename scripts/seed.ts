#!/usr/bin/env npx tsx
/**
 * Angsana Exchange — Slice 2 Seed Script
 *
 * Creates everything needed for a working Slice 2 environment:
 *   1. Firebase Auth users (4 test users with displayNames)
 *   2. Custom claims on each user (tenantId, role, clientId, assignedClients, permittedModules)
 *   3. Firestore structure: tenant config, managed lists (all 6), clients, campaigns with targeting
 *
 * Idempotent: safe to re-run. Existing users are updated, Firestore docs are overwritten.
 *
 * Prerequisites:
 *   - gcloud auth application-default login  (or GOOGLE_APPLICATION_CREDENTIALS set)
 *   - Target project: angsana-exchange
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// =============================================================================
// Configuration
// =============================================================================

const PROJECT_ID = 'angsana-exchange';
const TENANT_ID = 'angsana';
const DEFAULT_PASSWORD = 'Exchange2026!';

// =============================================================================
// Firebase Admin initialisation
// =============================================================================

function initAdmin() {
  if (getApps().length > 0) return;

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('  Using GOOGLE_APPLICATION_CREDENTIALS');
    initializeApp({
      credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      projectId: PROJECT_ID,
    });
  } else {
    // Application Default Credentials (gcloud auth application-default login)
    console.log('  Using Application Default Credentials');
    initializeApp({ projectId: PROJECT_ID });
  }
}

// =============================================================================
// Test Users
// =============================================================================

interface TestUser {
  email: string;
  displayName: string;
  password: string;
  claims: {
    tenantId: string;
    role: 'internal-admin' | 'internal-user' | 'client-approver' | 'client-viewer';
    clientId: string | null;
    assignedClients: string[] | null;
    permittedModules: string[];
  };
}

const TEST_USERS: TestUser[] = [
  {
    email: 'keith@angsana.com',
    displayName: 'Keith New',
    password: DEFAULT_PASSWORD,
    claims: {
      tenantId: TENANT_ID,
      role: 'internal-admin',
      clientId: null,
      assignedClients: ['*'],
      permittedModules: [
        'campaigns', 'checkins', 'actions', 'sowhats', 'wishlists',
        'dnc', 'msa-psl', 'documents', 'dashboard', 'admin',
      ],
    },
  },
  {
    email: 'mike@angsana.com',
    displayName: 'Mike Cole',
    password: DEFAULT_PASSWORD,
    claims: {
      tenantId: TENANT_ID,
      role: 'internal-user',
      clientId: null,
      assignedClients: ['cegid-spain', 'wavix'],
      permittedModules: [
        'campaigns', 'checkins', 'actions', 'sowhats', 'wishlists',
        'dnc', 'msa-psl', 'documents', 'dashboard',
      ],
    },
  },
  {
    email: 'alessandro@cegid.com',
    displayName: 'Alessandro Rossi',
    password: DEFAULT_PASSWORD,
    claims: {
      tenantId: TENANT_ID,
      role: 'client-approver',
      clientId: 'cegid-spain',
      assignedClients: null,
      permittedModules: [
        'campaigns', 'checkins', 'actions', 'sowhats', 'wishlists', 'documents', 'dashboard', 'approvals',
      ],
    },
  },
  {
    email: 'monica@cegid.com',
    displayName: 'Monica Garcia',
    password: DEFAULT_PASSWORD,
    claims: {
      tenantId: TENANT_ID,
      role: 'client-viewer',
      clientId: 'cegid-spain',
      assignedClients: null,
      permittedModules: [
        'campaigns', 'checkins', 'actions', 'sowhats', 'wishlists', 'documents', 'dashboard',
      ],
    },
  },
];

// =============================================================================
// Seed Auth Users + Custom Claims
// =============================================================================

async function seedUsers() {
  const auth = getAuth();

  for (const user of TEST_USERS) {
    let uid: string;

    try {
      // Check if user already exists
      const existing = await auth.getUserByEmail(user.email);
      uid = existing.uid;
      console.log(`  ✓ User exists: ${user.email} (${uid})`);

      // Update display name and password
      await auth.updateUser(uid, {
        displayName: user.displayName,
        password: user.password,
      });
      console.log(`    Updated displayName and password`);
    } catch (err: unknown) {
      const firebaseErr = err as { code?: string; message?: string };
      if (firebaseErr.code === 'auth/user-not-found') {
        // Create new user
        const created = await auth.createUser({
          email: user.email,
          displayName: user.displayName,
          password: user.password,
          emailVerified: true,
        });
        uid = created.uid;
        console.log(`  ✓ Created user: ${user.email} (${uid})`);
      } else {
        throw err;
      }
    }

    // Set custom claims
    await auth.setCustomUserClaims(uid, user.claims);
    console.log(`    Set claims: role=${user.claims.role}, clientId=${user.claims.clientId}`);
  }
}

// =============================================================================
// Firestore Seed Data
// =============================================================================

async function seedFirestore() {
  const db = getFirestore();
  const now = Timestamp.now();

  const tenantRef = db.collection('tenants').doc(TENANT_ID);

  // --- Tenant config ---
  console.log('  Seeding tenant config...');
  await tenantRef.set({
    name: 'Angsana',
    displayName: 'Angsana Business Consulting',
    region: 'europe-west2',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  // --- Managed Lists ---
  console.log('  Seeding managed lists...');
  const managedListsRef = tenantRef.collection('managedLists');

  // 6.1 serviceTypes (7 items per spec)
  await managedListsRef.doc('serviceTypes').set({
    items: [
      { id: 'lg-new', label: 'Lead Gen — New Business', active: true },
      { id: 'lg-cross', label: 'Lead Gen — Cross-Sell', active: true },
      { id: 'abm', label: 'Account-Based Marketing', active: true },
      { id: 'event', label: 'Event Follow-Up', active: true },
      { id: 'reactivation', label: 'Warm Reactivation', active: true },
      { id: 'pipeline', label: 'Pipeline Acceleration', active: true },
      { id: 'research', label: 'Market Research', active: true },
    ],
    updatedAt: now,
    updatedBy: 'seed-script',
  });
  console.log('    ✓ serviceTypes (7 items)');

  // 6.2 sectors (10 items per spec)
  await managedListsRef.doc('sectors').set({
    items: [
      { id: 'technology', label: 'Technology', active: true },
      { id: 'financial-services', label: 'Financial Services', active: true },
      { id: 'healthcare-life-sciences', label: 'Healthcare & Life Sciences', active: true },
      { id: 'retail-consumer', label: 'Retail & Consumer', active: true },
      { id: 'manufacturing', label: 'Manufacturing', active: true },
      { id: 'professional-services', label: 'Professional Services', active: true },
      { id: 'energy-utilities', label: 'Energy & Utilities', active: true },
      { id: 'media-telecoms', label: 'Media & Telecoms', active: true },
      { id: 'public-sector', label: 'Public Sector', active: true },
      { id: 'education', label: 'Education', active: true },
    ],
    updatedAt: now,
    updatedBy: 'seed-script',
  });
  console.log('    ✓ sectors (10 items)');

  // 6.3 geographies (12 items per spec)
  await managedListsRef.doc('geographies').set({
    items: [
      { id: 'uk', label: 'UK', active: true },
      { id: 'ireland', label: 'Ireland', active: true },
      { id: 'dach', label: 'DACH (Germany/Austria/Switzerland)', active: true },
      { id: 'nordics', label: 'Nordics', active: true },
      { id: 'benelux', label: 'Benelux', active: true },
      { id: 'france', label: 'France', active: true },
      { id: 'iberia', label: 'Iberia (Spain/Portugal)', active: true },
      { id: 'italy', label: 'Italy', active: true },
      { id: 'cee', label: 'Central & Eastern Europe', active: true },
      { id: 'middle-east', label: 'Middle East', active: true },
      { id: 'north-america', label: 'North America', active: true },
      { id: 'apac', label: 'APAC', active: true },
    ],
    updatedAt: now,
    updatedBy: 'seed-script',
  });
  console.log('    ✓ geographies (12 items)');

  // 6.4 titleBands (11 items per spec, with orientation)
  await managedListsRef.doc('titleBands').set({
    items: [
      { id: 'cto-cio-cdo', label: 'CTO / CIO / CDO', orientation: 'external', active: true },
      { id: 'cfo-finance-director', label: 'CFO / Finance Director', orientation: 'internal', active: true },
      { id: 'vp-director-it', label: 'VP / Director of IT', orientation: 'external', active: true },
      { id: 'vp-director-marketing', label: 'VP / Director of Marketing', orientation: 'external', active: true },
      { id: 'vp-director-sales', label: 'VP / Director of Sales', orientation: 'external', active: true },
      { id: 'vp-director-operations', label: 'VP / Director of Operations', orientation: 'internal', active: true },
      { id: 'vp-director-hr', label: 'VP / Director of HR', orientation: 'internal', active: true },
      { id: 'vp-director-procurement', label: 'VP / Director of Procurement', orientation: 'internal', active: true },
      { id: 'head-digital-transformation', label: 'Head of Digital / Transformation', orientation: 'mixed', active: true },
      { id: 'managing-director-gm', label: 'Managing Director / GM', orientation: 'mixed', active: true },
      { id: 'c-suite-ceo-coo', label: 'C-Suite (CEO, COO)', orientation: 'mixed', active: true },
    ],
    updatedAt: now,
    updatedBy: 'seed-script',
  });
  console.log('    ✓ titleBands (11 items)');

  // 6.5 companySizes (4 items per spec)
  await managedListsRef.doc('companySizes').set({
    items: [
      { id: 'enterprise', label: 'Enterprise (5000+ employees)', active: true },
      { id: 'large-mid-market', label: 'Large Mid-Market (1000–5000)', active: true },
      { id: 'mid-market', label: 'Mid-Market (250–1000)', active: true },
      { id: 'upper-sme', label: 'Upper SME (50–250)', active: true },
    ],
    updatedAt: now,
    updatedBy: 'seed-script',
  });
  console.log('    ✓ companySizes (4 items)');

  // 6.6 therapyAreas (9 items per spec)
  await managedListsRef.doc('therapyAreas').set({
    items: [
      { id: 'oncology', label: 'Oncology', active: true },
      { id: 'cardiology', label: 'Cardiology', active: true },
      { id: 'neurology', label: 'Neurology', active: true },
      { id: 'immunology', label: 'Immunology', active: true },
      { id: 'rare-disease', label: 'Rare Disease', active: true },
      { id: 'respiratory', label: 'Respiratory', active: true },
      { id: 'diabetes-metabolic', label: 'Diabetes & Metabolic', active: true },
      { id: 'vaccines', label: 'Vaccines', active: true },
      { id: 'cell-gene-therapy', label: 'Cell & Gene Therapy', active: true },
    ],
    updatedAt: now,
    updatedBy: 'seed-script',
  });
  console.log('    ✓ therapyAreas (9 items)');

  // --- Client: Cegid Spain (full, with campaigns) ---
  console.log('  Seeding client: cegid-spain...');
  const cegidRef = tenantRef.collection('clients').doc('cegid-spain');

  await cegidRef.set({
    name: 'Cegid Group Spain',
    status: 'active',
    sfAccountId: null,
    slug: 'cegid-spain',
    tier: 'premium',
    capabilities: [],
    therapyAreas: [],
    conflictedTherapyAreas: [],
    competitors: ['Oracle Retail', 'SAP', 'Shopify POS'],
    logoPath: null,
    createdAt: now,
    updatedAt: now,
  });

  // 6.7 Campaigns for Cegid Spain — updated with targeting fields and status history
  console.log('  Seeding campaigns for cegid-spain...');
  const campaignsRef = cegidRef.collection('campaigns');

  const campaigns = [
    {
      id: 'iberia-retail-pos-fashion',
      data: {
        campaignName: 'Iberia Retail POS — Fashion & Luxury',
        status: 'active',
        serviceType: 'Lead Gen — New Business',
        serviceTypeId: 'lg-new',
        owner: 'Mike Cole',
        startDate: Timestamp.fromDate(new Date('2025-12-18')),
        campaignSummary:
          'Targeting CTO/CIO/Digital leaders at fashion and luxury retailers in Spain and Portugal for Cegid unified commerce platform.',
        // Targeting (Slice 2)
        targetGeographies: ['iberia'],
        targetSectors: ['retail-consumer'],
        targetTitles: ['cto-cio-cdo', 'vp-director-it', 'head-digital-transformation'],
        companySize: 'large-mid-market',
        // Messaging
        valueProposition: 'Unified commerce platform replacing legacy POS with real-time inventory and clienteling across channels.',
        painPoints: [
          'Fragmented POS systems across stores',
          'No real-time inventory visibility',
          'Poor omnichannel customer experience',
        ],
        selectedSoWhats: [],
        // Lifecycle
        statusHistory: [
          { from: null, to: 'draft', timestamp: new Date('2025-12-10').toISOString(), changedBy: 'mike@angsana.com' },
          { from: 'draft', to: 'active', timestamp: new Date('2025-12-18').toISOString(), changedBy: 'mike@angsana.com' },
        ],
        pauseReason: '',
        createdBy: 'mike@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2025-12-10')),
        updatedAt: now,
      },
    },
    {
      id: 'iberia-retail-pos-outdoor',
      data: {
        campaignName: 'Iberia Retail POS — Outdoor & Sportswear',
        status: 'active',
        serviceType: 'Lead Gen — New Business',
        serviceTypeId: 'lg-new',
        owner: 'Mike Cole',
        startDate: Timestamp.fromDate(new Date('2026-01-15')),
        campaignSummary:
          'Same proposition targeting outdoor, sportswear, and activewear retailers across Iberia.',
        // Targeting (Slice 2)
        targetGeographies: ['iberia'],
        targetSectors: ['retail-consumer'],
        targetTitles: ['cto-cio-cdo', 'vp-director-it'],
        companySize: 'mid-market',
        // Messaging
        valueProposition: 'Cloud-native retail management for sportswear and outdoor brands scaling across Iberia.',
        painPoints: [
          'Seasonal inventory challenges',
          'Disconnected e-commerce and physical store systems',
        ],
        selectedSoWhats: [],
        // Lifecycle
        statusHistory: [
          { from: null, to: 'draft', timestamp: new Date('2026-01-08').toISOString(), changedBy: 'mike@angsana.com' },
          { from: 'draft', to: 'active', timestamp: new Date('2026-01-15').toISOString(), changedBy: 'mike@angsana.com' },
        ],
        pauseReason: '',
        createdBy: 'mike@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2026-01-08')),
        updatedAt: now,
      },
    },
    {
      id: 'retail-forum-event-followup',
      data: {
        campaignName: 'Retail Forum Event Follow-Up',
        status: 'draft',
        serviceType: 'Event Follow-Up',
        serviceTypeId: 'event',
        owner: 'Deborah Rey',
        startDate: Timestamp.fromDate(new Date('2026-02-20')),
        campaignSummary:
          'Follow-up outreach to attendees of the 2026 Retail Forum event. Speaker-led content positioning.',
        // Targeting (Slice 2)
        targetGeographies: ['iberia'],
        targetSectors: ['retail-consumer'],
        targetTitles: ['cto-cio-cdo', 'managing-director-gm', 'vp-director-marketing'],
        companySize: 'large-mid-market',
        // Messaging
        valueProposition: '',
        painPoints: [],
        selectedSoWhats: [],
        // Lifecycle
        statusHistory: [
          { from: null, to: 'draft', timestamp: new Date('2026-02-01').toISOString(), changedBy: 'mike@angsana.com' },
        ],
        pauseReason: '',
        createdBy: 'mike@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2026-02-01')),
        updatedAt: now,
      },
    },
  ];

  for (const campaign of campaigns) {
    await campaignsRef.doc(campaign.id).set(campaign.data);
    console.log(`    ✓ Campaign: ${campaign.data.campaignName}`);
  }

  // --- Check-ins for Cegid Spain ---
  console.log('  Seeding check-ins for cegid-spain...');
  const checkInsRef = cegidRef.collection('checkIns');

  const checkin1Ref = checkInsRef.doc('checkin-kickoff');
  const checkin2Ref = checkInsRef.doc('checkin-regular-jan');

  await checkin1Ref.set({
    date: Timestamp.fromDate(new Date('2025-12-18')),
    type: 'kick-off',
    attendees: ['Keith New', 'Mike Cole', 'Alessandro Originale'],
    duration: 60,
    relatedCampaigns: ['iberia-retail-pos-fashion', 'iberia-retail-pos-outdoor'],
    keyPoints: [
      'Agreed ICP: CTO/CIO at mid-market retailers in Iberia',
      'Two campaigns: Fashion & Luxury (premium segment) and Outdoor & Sportswear',
      'Cegid to provide updated competitor list by end of week',
      'Target list sourcing to begin Jan, first calls Feb',
    ],
    decisions: [
      { text: 'Split Iberia POS into two campaigns by vertical', assignee: 'Mike Cole', dueDate: '2025-12-20', createAction: true },
    ],
    nextSteps: [
      { text: 'Source initial target list for Fashion & Luxury vertical', owner: 'Research Team', targetDate: '2026-01-15', createAction: true },
    ],
    nextCheckInDate: Timestamp.fromDate(new Date('2026-01-15')),
    generatedActionIds: ['action-1', 'action-2'],
    createdBy: 'keith@angsana.com',
    createdAt: Timestamp.fromDate(new Date('2025-12-18')),
    updatedAt: Timestamp.fromDate(new Date('2025-12-18')),
  });
  console.log('    ✓ Check-in: Kick-off (18 Dec 2025)');

  await checkin2Ref.set({
    date: Timestamp.fromDate(new Date('2026-01-15')),
    type: 'regular',
    attendees: ['Mike Cole', 'Alessandro Originale', 'Monica Satizabal'],
    duration: 30,
    relatedCampaigns: ['iberia-retail-pos-fashion', 'iberia-retail-pos-outdoor'],
    keyPoints: [
      'Target list for Fashion & Luxury approved — 312 TLMs',
      'Outdoor & Sportswear list still in sourcing — research team needs SIC codes clarified',
      'Client wants to add Retail Forum Event Follow-Up as third campaign',
    ],
    decisions: [
      { text: 'Create Retail Forum Event Follow-Up campaign', assignee: 'Mike Cole', dueDate: '2026-01-20', createAction: true },
      { text: 'Provide SIC code clarification for outdoor retail vertical', assignee: 'Alessandro Originale', dueDate: '2026-01-22', createAction: true },
    ],
    nextSteps: [
      { text: 'Begin calling on Fashion & Luxury list', owner: 'Deborah Rey', targetDate: '2026-02-01', createAction: true },
    ],
    nextCheckInDate: Timestamp.fromDate(new Date('2026-02-15')),
    generatedActionIds: ['action-3', 'action-4'],
    createdBy: 'mike@angsana.com',
    createdAt: Timestamp.fromDate(new Date('2026-01-15')),
    updatedAt: Timestamp.fromDate(new Date('2026-01-15')),
  });
  console.log('    ✓ Check-in: Regular (15 Jan 2026)');

  // --- Actions for Cegid Spain ---
  console.log('  Seeding actions for cegid-spain...');
  const actionsRef = cegidRef.collection('actions');

  const actions = [
    {
      id: 'action-1',
      data: {
        title: 'Split Iberia POS into two campaigns',
        description: '',
        assignedTo: 'Mike Cole',
        dueDate: Timestamp.fromDate(new Date('2025-12-20')),
        status: 'done',
        priority: 'medium',
        source: { type: 'checkin', ref: 'checkin-kickoff' },
        relatedCampaign: '',
        createdBy: 'keith@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2025-12-18')),
        updatedAt: Timestamp.fromDate(new Date('2025-12-20')),
      },
    },
    {
      id: 'action-2',
      data: {
        title: 'Source target list for Fashion & Luxury',
        description: '',
        assignedTo: 'Research Team',
        dueDate: Timestamp.fromDate(new Date('2026-01-15')),
        status: 'done',
        priority: 'medium',
        source: { type: 'checkin', ref: 'checkin-kickoff' },
        relatedCampaign: 'iberia-retail-pos-fashion',
        createdBy: 'keith@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2025-12-18')),
        updatedAt: Timestamp.fromDate(new Date('2026-01-14')),
      },
    },
    {
      id: 'action-3',
      data: {
        title: 'Create Retail Forum Event Follow-Up campaign',
        description: '',
        assignedTo: 'Mike Cole',
        dueDate: Timestamp.fromDate(new Date('2026-01-20')),
        status: 'done',
        priority: 'medium',
        source: { type: 'checkin', ref: 'checkin-regular-jan' },
        relatedCampaign: '',
        createdBy: 'mike@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2026-01-15')),
        updatedAt: Timestamp.fromDate(new Date('2026-01-20')),
      },
    },
    {
      id: 'action-4',
      data: {
        title: 'Provide SIC code clarification for outdoor retail',
        description: '',
        assignedTo: 'Alessandro Originale',
        dueDate: Timestamp.fromDate(new Date('2026-01-22')),
        status: 'open',
        priority: 'high',
        source: { type: 'checkin', ref: 'checkin-regular-jan' },
        relatedCampaign: 'iberia-retail-pos-outdoor',
        createdBy: 'mike@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2026-01-15')),
        updatedAt: Timestamp.fromDate(new Date('2026-01-15')),
      },
    },
    {
      id: 'action-5',
      data: {
        title: 'Review Cegid competitor positioning vs Oracle Retail',
        description: 'Compare Cegid unified commerce features against Oracle Retail Cloud for Iberia market positioning.',
        assignedTo: 'Keith New',
        dueDate: Timestamp.fromDate(new Date('2026-04-01')),
        status: 'in-progress',
        priority: 'medium',
        source: { type: 'manual' },
        relatedCampaign: '',
        createdBy: 'keith@angsana.com',
        createdAt: Timestamp.fromDate(new Date('2026-02-10')),
        updatedAt: Timestamp.fromDate(new Date('2026-03-15')),
      },
    },
  ];

  for (const action of actions) {
    await actionsRef.doc(action.id).set(action.data);
    console.log(`    ✓ Action: ${action.data.title} (${action.data.status})`);
  }

  // --- Wishlists for Cegid Spain ---
  console.log('  Seeding wishlists for cegid-spain...');
  const wishlistsRef = cegidRef.collection('wishlists');

  const wishlists = [
    {
      id: 'wishlist-1',
      data: {
        companyName: 'El Corte Inglés',
        sector: 'retail-consumer',
        geography: 'iberia',
        priority: 'high',
        notes: 'Largest department store chain in Spain. Key target.',
        status: 'added-to-target-list',
        campaignRef: 'iberia-retail-pos-fashion',
        addedBy: 'alessandro@cegid.com',
        addedDate: Timestamp.fromDate(new Date('2026-01-10')),
        updatedAt: Timestamp.fromDate(new Date('2026-01-20')),
      },
    },
    {
      id: 'wishlist-2',
      data: {
        companyName: 'Mango',
        sector: 'retail-consumer',
        geography: 'iberia',
        priority: 'high',
        notes: 'Barcelona HQ. Fast fashion, considering POS upgrade.',
        status: 'under-review',
        campaignRef: '',
        addedBy: 'alessandro@cegid.com',
        addedDate: Timestamp.fromDate(new Date('2026-02-20')),
        updatedAt: Timestamp.fromDate(new Date('2026-03-01')),
      },
    },
    {
      id: 'wishlist-3',
      data: {
        companyName: 'Decathlon Spain',
        sector: 'retail-consumer',
        geography: 'iberia',
        priority: 'medium',
        notes: 'Outdoor & sports retail. Good fit for sportswear campaign.',
        status: 'new',
        campaignRef: '',
        addedBy: 'mike@angsana.com',
        addedDate: Timestamp.fromDate(new Date('2026-04-01')),
        updatedAt: Timestamp.fromDate(new Date('2026-04-01')),
      },
    },
    {
      id: 'wishlist-4',
      data: {
        companyName: 'Tendam',
        sector: 'retail-consumer',
        geography: 'iberia',
        priority: 'medium',
        notes: 'Cortefiel, Springfield, Women\'secret brands.',
        status: 'new',
        campaignRef: '',
        addedBy: 'alessandro@cegid.com',
        addedDate: Timestamp.fromDate(new Date('2026-04-03')),
        updatedAt: Timestamp.fromDate(new Date('2026-04-03')),
      },
    },
    {
      id: 'wishlist-5',
      data: {
        companyName: 'Desigual',
        sector: 'retail-consumer',
        geography: 'iberia',
        priority: 'low',
        notes: 'Too small for current campaign scope.',
        status: 'rejected',
        campaignRef: '',
        addedBy: 'mike@angsana.com',
        addedDate: Timestamp.fromDate(new Date('2026-03-15')),
        updatedAt: Timestamp.fromDate(new Date('2026-03-20')),
      },
    },
  ];

  for (const wishlist of wishlists) {
    await wishlistsRef.doc(wishlist.id).set(wishlist.data);
    console.log(`    ✓ Wishlist: ${wishlist.data.companyName} (${wishlist.data.status})`);
  }

  // --- So Whats for Cegid Spain ---
  console.log('  Seeding So Whats for cegid-spain...');
  const soWhatsRef = cegidRef.collection('soWhats');

  const soWhats = [
    {
      id: 'sowhat-1',
      data: {
        headline: 'Cegid cut payroll processing time by 40% for mid-market retailers',
        emailVersion: 'Cegid\'s payroll platform reduced processing time by 40% for mid-market retail businesses, freeing finance teams to focus on strategic work.',
        supportingEvidence: 'Carrefour case study, 2024. 40% reduction measured across 12-month rollout.',
        audienceTags: ['cfo-finance-director', 'vp-director-hr'],
        orientationTags: ['external-facing'],
        sourceRef: 'Carrefour case study, 2024',
        status: 'approved',
        createdBy: 'mike@angsana.com',
        createdDate: Timestamp.fromDate(new Date('2026-03-01')),
        updatedBy: 'keith@angsana.com',
        updatedDate: Timestamp.fromDate(new Date('2026-03-05')),
      },
    },
    {
      id: 'sowhat-2',
      data: {
        headline: 'One platform for payroll, HR and talent across 20+ countries',
        emailVersion: 'Manage payroll, HR administration, and talent development across 20+ countries from a single cloud platform — no integration headaches.',
        supportingEvidence: 'Cegid operates in 23 countries. Platform consolidation data from 2024 annual report.',
        audienceTags: ['cfo-finance-director', 'cto-cio-cdo'],
        orientationTags: ['external-facing'],
        sourceRef: 'Cegid 2024 Annual Report',
        status: 'approved',
        createdBy: 'mike@angsana.com',
        createdDate: Timestamp.fromDate(new Date('2026-03-01')),
        updatedBy: 'keith@angsana.com',
        updatedDate: Timestamp.fromDate(new Date('2026-03-05')),
      },
    },
    {
      id: 'sowhat-3',
      data: {
        headline: 'Your compliance risk is someone else\'s automation',
        emailVersion: 'Multi-country payroll compliance changes automatically — no manual tracking, no missed deadlines, no fines.',
        supportingEvidence: '98.7% compliance rate across client base. Zero regulatory penalties reported in 2024.',
        audienceTags: ['cfo-finance-director'],
        orientationTags: ['external-facing'],
        sourceRef: 'Cegid compliance report, 2024',
        status: 'approved',
        createdBy: 'keith@angsana.com',
        createdDate: Timestamp.fromDate(new Date('2026-03-02')),
        updatedBy: 'keith@angsana.com',
        updatedDate: Timestamp.fromDate(new Date('2026-03-06')),
      },
    },
    {
      id: 'sowhat-4',
      data: {
        headline: 'Mid-market gets enterprise-grade HR tech without enterprise complexity',
        emailVersion: 'Enterprise-grade talent management and workforce analytics, sized and priced for mid-market organisations.',
        supportingEvidence: 'Needs specific pricing/sizing data from Cegid.',
        audienceTags: ['vp-director-hr', 'cto-cio-cdo'],
        orientationTags: ['external-facing', 'internal-facing'],
        sourceRef: '',
        status: 'draft',
        createdBy: 'alessandro@cegid.com',
        createdDate: Timestamp.fromDate(new Date('2026-03-10')),
        updatedBy: 'alessandro@cegid.com',
        updatedDate: Timestamp.fromDate(new Date('2026-03-10')),
      },
    },
    {
      id: 'sowhat-5',
      data: {
        headline: 'Retail workforce scheduling that actually reflects footfall patterns',
        emailVersion: 'AI-driven workforce scheduling that aligns staffing levels with real-time footfall data, reducing overstaffing costs by up to 25%.',
        supportingEvidence: 'Pilot data from 3 retail clients, Q4 2024. Needs final validation.',
        audienceTags: ['vp-director-operations'],
        orientationTags: ['external-facing'],
        sourceRef: 'Pilot data Q4 2024',
        status: 'draft',
        createdBy: 'mike@angsana.com',
        createdDate: Timestamp.fromDate(new Date('2026-03-12')),
        updatedBy: 'mike@angsana.com',
        updatedDate: Timestamp.fromDate(new Date('2026-03-12')),
      },
    },
  ];

  for (const soWhat of soWhats) {
    await soWhatsRef.doc(soWhat.id).set(soWhat.data);
    console.log(`    ✓ So What: ${soWhat.data.headline.substring(0, 50)}... (${soWhat.data.status})`);
  }

  // Assign 3 approved So Whats to the first campaign (iberia-retail-pos-fashion)
  console.log('  Updating campaign selectedSoWhats...');
  await campaignsRef.doc('iberia-retail-pos-fashion').update({
    selectedSoWhats: ['sowhat-1', 'sowhat-2', 'sowhat-3'],
  });
  console.log('    ✓ Assigned 3 approved So Whats to Iberia Retail POS — Fashion & Luxury');

  // --- Client: Wavix (stub — no campaigns) ---
  console.log('  Seeding client: wavix (stub)...');
  const wavixRef = tenantRef.collection('clients').doc('wavix');

  await wavixRef.set({
    name: 'Wavix Technologies',
    status: 'active',
    sfAccountId: null,
    slug: 'wavix',
    tier: 'standard',
    capabilities: ['therapyAreas'],
    therapyAreas: ['oncology', 'cardiology', 'neurology'],
    conflictedTherapyAreas: ["respiratory"],
    competitors: ['Twilio', 'Vonage', 'Bandwidth'],
    logoPath: null,
    createdAt: now,
    updatedAt: now,
  });
}

// =============================================================================
// Seed Users Collection (Slice 6A)
// Creates queryable Firestore user documents mirroring Firebase Auth users.
// Firebase Auth remains the source of truth for authentication; this collection
// provides list/filter/search capabilities for the API and UI layers.
// =============================================================================

async function seedUsersCollection() {
  const db = getFirestore();
  const auth = getAuth();
  const now = Timestamp.now();
  const usersRef = db.collection('tenants').doc(TENANT_ID).collection('users');

  for (const user of TEST_USERS) {
    try {
      // Look up the Firebase Auth UID
      const authUser = await auth.getUserByEmail(user.email);
      const uid = authUser.uid;

      await usersRef.doc(uid).set({
        uid,
        email: user.email,
        displayName: user.displayName,
        role: user.claims.role,
        tenantId: TENANT_ID,
        clientId: user.claims.clientId,
        assignedClients: user.claims.assignedClients,
        status: 'active',
        createdAt: now,
        createdBy: null, // seed data
        lastLoginAt: null,
        disabledAt: null,
        disabledBy: null,
      }, { merge: true });

      console.log(`  ✓ User doc: ${user.email} (${uid}) → role=${user.claims.role}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Failed to seed user doc for ${user.email}: ${message}`);
    }
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Angsana Exchange — Slice 2 Seed Script      ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  console.log('→ Initialising Firebase Admin...');
  initAdmin();
  console.log('');

  console.log('→ Seeding Auth users + custom claims...');
  await seedUsers();
  console.log('');

  console.log('→ Seeding Firestore data...');
  await seedFirestore();
  console.log('');

  console.log('→ Seeding Users collection (Slice 6A)...');
  await seedUsersCollection();
  console.log('');

  console.log('✅ Seed complete!');
  console.log('');
  console.log('Managed lists seeded:');
  console.log('  serviceTypes (7), sectors (10), geographies (12),');
  console.log('  titleBands (11), companySizes (4), therapyAreas (9)');
  console.log('');
  console.log('Test accounts (password: Exchange2026!):');
  for (const user of TEST_USERS) {
    console.log(`  ${user.email.padEnd(28)} ${user.claims.role}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('❌ Seed failed:', err.message || err);
  console.error('');
  if (err.message?.includes('Could not load the default credentials')) {
    console.error('Hint: Run "gcloud auth application-default login" first.');
  }
  process.exit(1);
});

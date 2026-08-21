import type { Database } from './client'
import { id, normalisePhone } from './repo'
import {
  branches,
  operatories,
  organizations,
  patients,
  phoneNumbers,
  providers,
  services,
  users,
} from './schema'

/**
 * A whole clinic, created in one call.
 *
 * This is the onboarding path, not a fixture: signing up a practice, importing
 * a demo tenant and building a test database all need the same rows in the same
 * order, and three ways of writing them is three ways for them to drift.
 *
 * Every id is derived from the org so two tenants seeded into one database
 * never collide.
 */

export interface SeedBranch {
  key: string
  name: string
  area: string
  city: string
  phone?: string
  emergencyPhone?: string
  chairs?: Array<{ name: string; equipment?: string[] }>
}

export interface SeedProvider {
  key: string
  name: string
  title: string
  qualifications?: string
  specialties?: string[]
  languages?: string[]
  days?: number[]
  branchKeys?: string[]
  pronunciation?: string
}

export interface SeedService {
  key: string
  name: string
  alsoCalled?: string[]
  durationMin: number
  priceMinPaise?: number
  priceMaxPaise?: number
  requiresSpecialty?: string[]
  requiresEquipment?: string[]
  recallDays?: number
}

export interface SeedOrg {
  slug: string
  name: string
  timezone?: string
  voice?: string
  phoneNumbers?: string[]
  branches: SeedBranch[]
  providers: SeedProvider[]
  services: SeedService[]
  owner?: { email: string; name: string; passwordHash: string }
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6]
const DEFAULT_HOURS = WEEKDAYS.map((day) => ({ day, open: '09:30', close: '19:30' }))

export async function seedOrganization(db: Database, spec: SeedOrg): Promise<{ orgId: string }> {
  const orgId = `org_${spec.slug}`

  await db.insert(organizations).values({
    id: orgId,
    name: spec.name,
    slug: spec.slug,
    timezone: spec.timezone ?? 'Asia/Kolkata',
    voice: spec.voice ?? 'Leda',
  })

  const branchId = (key: string) => `${orgId}_br_${key}`
  const providerId = (key: string) => `${orgId}_pr_${key}`
  const serviceId = (key: string) => `${orgId}_sv_${key}`

  await db.insert(branches).values(
    spec.branches.map((b) => ({
      id: branchId(b.key),
      orgId,
      name: b.name,
      area: b.area,
      city: b.city,
      phone: b.phone,
      emergencyPhone: b.emergencyPhone,
      hours: DEFAULT_HOURS,
      facilities: [] as string[],
    })),
  )

  const chairRows = spec.branches.flatMap((b) =>
    (b.chairs ?? [{ name: 'Chair 1' }, { name: 'Chair 2' }]).map((c, i) => ({
      id: `${orgId}_op_${b.key}${i + 1}`,
      orgId,
      branchId: branchId(b.key),
      name: c.name,
      equipment: c.equipment ?? [],
    })),
  )
  if (chairRows.length > 0) await db.insert(operatories).values(chairRows)

  await db.insert(providers).values(
    spec.providers.map((p) => ({
      id: providerId(p.key),
      orgId,
      name: p.name,
      title: p.title,
      qualifications: p.qualifications,
      specialties: p.specialties ?? [],
      languages: p.languages ?? ['en-IN', 'hi-IN'],
      days: p.days ?? WEEKDAYS,
      branchIds: (p.branchKeys ?? spec.branches.map((b) => b.key)).map(branchId),
      pronunciation: p.pronunciation,
    })),
  )

  await db.insert(services).values(
    spec.services.map((s) => ({
      id: serviceId(s.key),
      orgId,
      name: s.name,
      alsoCalled: s.alsoCalled ?? [],
      durationMin: s.durationMin,
      priceMinPaise: s.priceMinPaise,
      priceMaxPaise: s.priceMaxPaise,
      requiresSpecialty: s.requiresSpecialty ?? [],
      requiresEquipment: s.requiresEquipment ?? [],
      recallDays: s.recallDays,
    })),
  )

  if (spec.phoneNumbers?.length) {
    await db.insert(phoneNumbers).values(
      spec.phoneNumbers.map((e164, i) => ({
        id: id('num'),
        orgId,
        branchId: branchId(spec.branches[Math.min(i, spec.branches.length - 1)]!.key),
        e164: normalisePhone(e164),
        label: spec.branches[Math.min(i, spec.branches.length - 1)]!.name,
      })),
    )
  }

  if (spec.owner) {
    await db.insert(users).values({
      id: id('usr'),
      orgId,
      email: spec.owner.email.toLowerCase(),
      name: spec.owner.name,
      passwordHash: spec.owner.passwordHash,
      role: 'owner',
    })
  }

  return { orgId }
}

/** The demo tenant — the practice the console has always answered for. */
export const SMILE_DENTAL: SeedOrg = {
  slug: 'smile',
  name: 'Smile Dental Care',
  branches: [
    {
      key: 'bandra',
      name: 'Smile Dental Care — Bandra West',
      area: 'Bandra West',
      city: 'Mumbai',
      phone: '+912226551200',
      emergencyPhone: '+919820011200',
      chairs: [
        { name: 'Chair 1', equipment: ['digital x-ray'] },
        { name: 'Chair 2', equipment: ['digital x-ray', 'rotary endo'] },
        { name: 'Surgical Suite', equipment: ['digital x-ray', 'rotary endo', 'surgical'] },
      ],
    },
    {
      key: 'andheri',
      name: 'Smile Dental Care — Andheri West',
      area: 'Andheri West',
      city: 'Mumbai',
      phone: '+912226551300',
      emergencyPhone: '+919820011300',
      chairs: [
        { name: 'Chair 1', equipment: ['digital x-ray'] },
        { name: 'Chair 2', equipment: ['digital x-ray', 'rotary endo'] },
      ],
    },
    {
      key: 'powai',
      name: 'Smile Dental Care — Powai',
      area: 'Powai',
      city: 'Mumbai',
      phone: '+912226551400',
      emergencyPhone: '+919820011400',
      chairs: [{ name: 'Chair 1', equipment: ['digital x-ray'] }],
    },
  ],
  providers: [
    {
      key: 'sharma',
      name: 'Dr. Ananya Sharma',
      title: 'General Dentist',
      qualifications: 'BDS, MDS (Conservative Dentistry)',
      specialties: ['general', 'restorative'],
      pronunciation: 'Sharma [SHAR-ma]',
    },
    {
      key: 'mehta',
      name: 'Dr. Rohan Mehta',
      title: 'Endodontist',
      qualifications: 'BDS, MDS (Endodontics)',
      specialties: ['endodontics', 'general'],
      pronunciation: 'Mehta [MAY-tah]',
    },
    {
      key: 'iyer',
      name: 'Dr. Kavita Iyer',
      title: 'Periodontist',
      qualifications: 'BDS, MDS (Periodontology)',
      specialties: ['periodontics', 'general'],
      pronunciation: 'Iyer [EYE-yer]',
    },
    {
      key: 'qureshi',
      name: 'Dr. Farhan Qureshi',
      title: 'Oral Surgeon',
      qualifications: 'BDS, MDS (Oral & Maxillofacial Surgery)',
      specialties: ['oral surgery'],
      pronunciation: 'Qureshi [ku-RAY-shee]',
    },
    {
      key: 'nair',
      name: 'Dr. Meera Nair',
      title: 'Orthodontist',
      qualifications: 'BDS, MDS (Orthodontics)',
      specialties: ['orthodontics'],
      pronunciation: 'Nair [NYE-er]',
    },
    {
      key: 'deshpande',
      name: 'Dr. Sanjay Deshpande',
      title: 'Prosthodontist',
      qualifications: 'BDS, MDS (Prosthodontics)',
      specialties: ['prosthodontics', 'general'],
      pronunciation: 'Deshpande [desh-PAAN-day]',
    },
  ],
  services: [
    { key: 'consult', name: 'Consultation', alsoCalled: ['checkup', 'check-up', 'first visit'], durationMin: 20, priceMinPaise: 50000, priceMaxPaise: 50000 },
    { key: 'scaling', name: 'Scaling & Polishing', alsoCalled: ['cleaning', 'safai', 'descaling', 'scaling'], durationMin: 40, priceMinPaise: 150000, priceMaxPaise: 250000, recallDays: 180 },
    { key: 'filling', name: 'Composite Filling', alsoCalled: ['filling', 'cavity', 'bharna'], durationMin: 45, priceMinPaise: 200000, priceMaxPaise: 400000 },
    { key: 'rct', name: 'Root Canal', alsoCalled: ['RCT', 'root canal treatment', 'nerve treatment'], durationMin: 90, priceMinPaise: 600000, priceMaxPaise: 1200000, requiresSpecialty: ['endodontics'], requiresEquipment: ['rotary endo'] },
    { key: 'crown', name: 'Crown Fitting', alsoCalled: ['crown', 'cap', 'capping'], durationMin: 60, priceMinPaise: 800000, priceMaxPaise: 2000000, requiresSpecialty: ['prosthodontics'] },
    { key: 'extraction', name: 'Tooth Extraction', alsoCalled: ['extraction', 'tooth removal', 'daant nikalna'], durationMin: 40, priceMinPaise: 250000, priceMaxPaise: 500000 },
    { key: 'wisdom', name: 'Wisdom Tooth Surgery', alsoCalled: ['wisdom tooth', 'akal daadh', 'third molar'], durationMin: 90, priceMinPaise: 800000, priceMaxPaise: 1800000, requiresSpecialty: ['oral surgery'], requiresEquipment: ['surgical'] },
    { key: 'whitening', name: 'Teeth Whitening', alsoCalled: ['whitening', 'bleaching'], durationMin: 60, priceMinPaise: 1000000, priceMaxPaise: 1800000 },
    { key: 'braces', name: 'Braces Consultation', alsoCalled: ['braces', 'aligners', 'Invisalign'], durationMin: 30, priceMinPaise: 80000, priceMaxPaise: 80000, requiresSpecialty: ['orthodontics'] },
    { key: 'adjust', name: 'Braces Adjustment', alsoCalled: ['tightening', 'wire change'], durationMin: 20, requiresSpecialty: ['orthodontics'] },
    { key: 'denture', name: 'Denture Fitting', alsoCalled: ['dentures', 'false teeth'], durationMin: 60, requiresSpecialty: ['prosthodontics'] },
    { key: 'emergency', name: 'Emergency Visit', alsoCalled: ['emergency', 'urgent', 'pain'], durationMin: 30 },
  ],
}

/** A handful of patients, so a demo tenant is not empty on first login. */
export async function seedPatients(db: Database, orgId: string): Promise<void> {
  const names = [
    ['Ravi Menon', '9820011001'],
    ['Priya Sharma', '9820011002'],
    ['Aditya Rao', '9820011003'],
    ['Fatima Sheikh', '9820011004'],
    ['Vikram Shetty', '9820011005'],
  ]
  await db.insert(patients).values(
    names.map(([name, phone]) => ({
      id: id('pat'),
      orgId,
      name: name!,
      phone: normalisePhone(phone!),
      preferredLanguage: 'en-IN',
    })),
  )
}

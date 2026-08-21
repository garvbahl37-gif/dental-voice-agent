import { randomBytes } from 'node:crypto'
import { connect } from './client'
import { createUser } from './auth'
import { seedOrganization, seedPatients, SMILE_DENTAL } from './seed'
import { organizations } from './schema'
import { eq } from 'drizzle-orm'

/**
 * Create the demo tenant.
 *
 * Idempotent: running it twice does not produce two Smile Dental Cares, because
 * the thing most likely to run this twice is a deploy hook.
 *
 * The owner password is generated and printed once rather than defaulted to
 * something memorable. A seeded `admin/admin` on a system holding patient
 * records is the kind of shortcut that survives all the way to production.
 */

async function main(): Promise<void> {
  const { db, close } = connect()
  try {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, SMILE_DENTAL.slug))
      .limit(1)

    if (existing) {
      console.log(`  ${SMILE_DENTAL.name} already exists (${existing.id}) — nothing to do`)
      return
    }

    const numbers = process.env.SEED_PHONE_NUMBERS?.split(',').map((s) => s.trim()).filter(Boolean)
    const { orgId } = await seedOrganization(db, { ...SMILE_DENTAL, phoneNumbers: numbers })
    await seedPatients(db, orgId)

    const email = process.env.SEED_OWNER_EMAIL ?? 'owner@smile.example'
    const password = process.env.SEED_OWNER_PASSWORD ?? randomBytes(12).toString('base64url')
    await createUser(db, { orgId, email, name: 'Practice Owner', password, role: 'owner' })

    console.log(`  seeded ${SMILE_DENTAL.name}`)
    console.log(`    org      ${orgId}`)
    console.log(`    branches ${SMILE_DENTAL.branches.length}`)
    console.log(`    dentists ${SMILE_DENTAL.providers.length}`)
    console.log(`    services ${SMILE_DENTAL.services.length}`)
    console.log(`    numbers  ${numbers?.length ?? 0}`)
    console.log('')
    console.log(`    sign in  ${email}`)
    if (!process.env.SEED_OWNER_PASSWORD) {
      console.log(`    password ${password}`)
      console.log('    (generated once — store it now, it is not recoverable)')
    }
  } finally {
    await close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })

import type { Plugin } from 'payload'
import { TwentyClient } from '../lib/twenty'

// ─── Types ──────────────────────────────────────────────────────────────────────

type FieldMapping = {
  sourceField: string
  targetField: string
  transform?: (v: unknown) => unknown
}

type TargetMapping = {
  object: 'people' | 'companies' | 'opportunities' | 'notes'
  fields: FieldMapping[]
  bodyField?: string
  linkToPersonByEmail?: string
}

type CollectionSyncConfig = {
  collection: string
  targets: TargetMapping[]
  strategy?: 'create-only' | 'upsert'
  formSubmission?: boolean
  condition?: (doc: Record<string, unknown>) => boolean
}

type TwentyCrmPluginConfig = {
  apiUrl: string
  apiKey: string
  sync: CollectionSyncConfig[]
  logs?: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Flatten Payload form-builder `submissionData` array into a plain object.
 * `submissionData` is `{ field: string; value: string }[]`
 */
function flattenSubmissionData(
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const submissionData = doc.submissionData as
    | Array<{ field: string; value: unknown }>
    | undefined

  if (!Array.isArray(submissionData)) return doc

  const flat: Record<string, unknown> = { ...doc }
  for (const entry of submissionData) {
    if (entry.field) {
      flat[entry.field] = entry.value
    }
  }

  // Carry over form title if present
  if (doc.form && typeof doc.form === 'object' && 'title' in doc.form) {
    flat._formTitle = (doc.form as Record<string, unknown>).title
  } else if (typeof doc.form === 'string') {
    flat._formTitle = doc.form
  }

  return flat
}

/**
 * Set a potentially nested field on a target object.
 * e.g. `setNestedField(obj, 'name.firstName', 'Ada')` → `obj.name.firstName = 'Ada'`
 */
function setNestedField(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.')
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

/**
 * Map source document fields to a Twenty API input object using field mappings.
 */
function mapFields(
  source: Record<string, unknown>,
  fields: FieldMapping[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const { sourceField, targetField, transform } of fields) {
    const rawValue = source[sourceField]
    if (rawValue === undefined) continue
    const value = transform ? transform(rawValue) : rawValue
    setNestedField(result, targetField, value)
  }

  return result
}

// ─── Plugin ─────────────────────────────────────────────────────────────────────

export function twentyCrmPlugin(config: TwentyCrmPluginConfig): Plugin {
  const client = new TwentyClient({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  })

  return (incomingConfig) => {
    const collections = (incomingConfig.collections || []).map((collection) => {
      const syncConfig = config.sync.find(
        (s) => s.collection === collection.slug,
      )
      if (!syncConfig) return collection

      return {
        ...collection,
        hooks: {
          ...collection.hooks,
          afterChange: [
            ...(collection.hooks?.afterChange || []),
            async ({
              doc,
              req,
              operation,
              context,
            }: {
              doc: Record<string, unknown>
              req: { payload: { logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void } } }
              operation: 'create' | 'update'
              context: Record<string, unknown>
            }) => {
              // Prevent sync loops — Phase 4 webhook handlers set this flag
              if (context.skipCrmSync) return doc

              // Check condition if provided
              if (syncConfig.condition && !syncConfig.condition(doc)) return doc

              const strategy = syncConfig.strategy ?? 'upsert'
              const logger = req.payload.logger
              const log = config.logs
                ? (msg: string) => logger.info(`[twenty-crm] ${msg}`)
                : () => {}

              // Fire-and-forget: don't block the Payload response
              syncToTwenty(doc, syncConfig, strategy, log).catch((err) => {
                logger.error(`[twenty-crm] Sync failed for ${collection.slug}:`, err)
                // Capture to Sentry if available globally
                try {
                  const Sentry = require('@sentry/nextjs')
                  Sentry.captureException(err, {
                    tags: { plugin: 'twenty-crm', collection: collection.slug, operation },
                  })
                } catch {
                  // Sentry not available — error already logged
                }
              })

              return doc
            },
          ],
        },
      }
    })

    return { ...incomingConfig, collections }
  }

  // ── Sync Orchestration ──────────────────────────────────────────────────────

  async function syncToTwenty(
    rawDoc: Record<string, unknown>,
    syncConfig: CollectionSyncConfig,
    strategy: 'create-only' | 'upsert',
    log: (msg: string) => void,
  ): Promise<void> {
    // Flatten form submission data if needed
    const doc = syncConfig.formSubmission
      ? flattenSubmissionData(rawDoc)
      : rawDoc

    for (const target of syncConfig.targets) {
      await syncTarget(doc, target, strategy, log)
    }
  }

  async function syncTarget(
    doc: Record<string, unknown>,
    target: TargetMapping,
    strategy: 'create-only' | 'upsert',
    log: (msg: string) => void,
  ): Promise<void> {
    const mapped = mapFields(doc, target.fields)

    switch (target.object) {
      case 'people': {
        const email = mapped.email as string | undefined
        if (!email) {
          log('Skipping people sync — no email found')
          return
        }

        if (strategy === 'upsert') {
          const existing = await client.people.findByEmail(email)
          if (existing) {
            await client.people.update(existing.id, mapped)
            log(`Updated person ${existing.id} (${email})`)
          } else {
            const created = await client.people.create(mapped as any)
            log(`Created person ${created.id} (${email})`)
          }
        } else {
          const created = await client.people.create(mapped as any)
          log(`Created person ${created.id}`)
        }
        break
      }

      case 'companies': {
        if (strategy === 'upsert') {
          await client.companies.upsert([mapped as any])
          log('Upserted company')
        } else {
          await client.companies.create(mapped as any)
          log('Created company')
        }
        break
      }

      case 'opportunities': {
        if (strategy === 'upsert') {
          await client.opportunities.upsert([mapped as any])
          log('Upserted opportunity')
        } else {
          await client.opportunities.create(mapped as any)
          log('Created opportunity')
        }
        break
      }

      case 'notes': {
        const noteInput: Record<string, unknown> = { ...mapped }

        // Set note body from the designated field
        if (target.bodyField) {
          noteInput.body = doc[target.bodyField] ?? ''
        }

        // Link note to a person by looking up their email
        if (target.linkToPersonByEmail) {
          const email = doc[target.linkToPersonByEmail] as string | undefined
          if (email) {
            const person = await client.people.findByEmail(email)
            if (person) {
              // Twenty notes use noteTargets for associations; set pointOfContactId as fallback
              noteInput.pointOfContactId = person.id
              log(`Linking note to person ${person.id} (${email})`)
            } else {
              log(`Person not found for email ${email} — creating unlinked note`)
            }
          }
        }

        await client.notes.create(noteInput as any)
        log('Created note')
        break
      }
    }
  }
}

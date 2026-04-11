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

  if (doc.form && typeof doc.form === 'object' && 'title' in doc.form) {
    flat._formTitle = (doc.form as Record<string, unknown>).title
  } else if (typeof doc.form === 'string') {
    flat._formTitle = doc.form
  }

  return flat
}

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

// ─── Sync Logic ─────────────────────────────────────────────────────────────────

async function syncToTwenty(
  client: TwentyClient,
  rawDoc: Record<string, unknown>,
  syncConfig: CollectionSyncConfig,
  strategy: 'create-only' | 'upsert',
  log: (msg: string) => void,
): Promise<void> {
  const doc = syncConfig.formSubmission
    ? flattenSubmissionData(rawDoc)
    : rawDoc

  for (const target of syncConfig.targets) {
    await syncTarget(client, doc, target, strategy, log)
  }
}

async function syncTarget(
  client: TwentyClient,
  doc: Record<string, unknown>,
  target: TargetMapping,
  strategy: 'create-only' | 'upsert',
  log: (msg: string) => void,
): Promise<void> {
  const mapped = mapFields(doc, target.fields)

  switch (target.object) {
    case 'people': {
      const emails = mapped.emails as { primaryEmail?: string } | undefined
      const email = emails?.primaryEmail
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

      if (target.bodyField) {
        const bodyText = String(doc[target.bodyField] ?? '')
        noteInput.bodyV2 = { blocknote: JSON.stringify([{ type: 'paragraph', content: bodyText }]) }
      }

      // Create the note first, then link via noteTargets if needed
      const createdNote = await client.notes.create(noteInput as any)
      log(`Created note ${createdNote.id}`)

      if (target.linkToPersonByEmail) {
        const email = doc[target.linkToPersonByEmail] as string | undefined
        if (email) {
          const person = await client.people.findByEmail(email)
          if (person) {
            // Link note to person via noteTargets
            try {
              await client.execute(
                `mutation CreateNoteTarget($input: NoteTargetCreateInput!) {
                  createNoteTarget(data: $input) { id }
                }`,
                { input: { noteId: createdNote.id, targetPersonId: person.id } },
              )
              log(`Linked note ${createdNote.id} to person ${person.id} (${email})`)
            } catch (linkErr) {
              log(`Note created but linking failed: ${(linkErr as Error).message}`)
            }
          }
        }
      }
      break
    }
  }
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
              syncToTwenty(client, doc, syncConfig, strategy, log).catch(async (err) => {
                logger.error(`[twenty-crm] Sync failed for ${collection.slug}: ${(err as Error)?.message || err}`)
                try {
                  const Sentry = await import('@sentry/nextjs')
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
}

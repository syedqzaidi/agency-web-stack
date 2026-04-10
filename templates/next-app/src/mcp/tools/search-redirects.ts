import { z } from 'zod'
import type { PayloadRequest } from 'payload'

const text = (t: string) => ({ content: [{ text: t, type: 'text' as const }] })

export const searchRedirectsTools = [
  {
    name: 'reindex_search',
    description: 'Delete all documents in the search collection and reindex all published pages.',
    parameters: {},
    handler: async (_args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      // Fix #1: Payload 3 delete requires a single id — find all docs first, then delete each by ID.
      let deletedCount = 0
      let deleteErrors: Array<{ id: unknown; error: string }> = []

      try {
        const existing = await req.payload.find({
          collection: 'search',
          limit: 10000,
          depth: 0,
        })

        for (const doc of existing.docs) {
          try {
            await req.payload.delete({ collection: 'search', id: doc.id as string })
            deletedCount++
          } catch (err) {
            deleteErrors.push({ id: doc.id, error: err instanceof Error ? err.message : String(err) })
          }
        }
      } catch (err) {
        return text(
          JSON.stringify(
            { success: false, error: 'Failed to find existing search docs', details: err instanceof Error ? err.message : String(err) },
            null,
            2,
          ),
        )
      }

      let pages: Awaited<ReturnType<typeof req.payload.find>>
      try {
        pages = await req.payload.find({
          collection: 'pages',
          where: { _status: { equals: 'published' } },
          limit: 1000,
        })
      } catch (err) {
        return text(
          JSON.stringify(
            { success: false, error: 'Failed to find published pages', details: err instanceof Error ? err.message : String(err) },
            null,
            2,
          ),
        )
      }

      const truncationWarning = pages.totalDocs > pages.docs.length
        ? `\nWarning: ${pages.totalDocs} total pages, showing first ${pages.docs.length}.`
        : ''

      let reindexed = 0
      const reindexErrors: Array<{ pageId: unknown; error: string }> = []

      try {
        for (const page of pages.docs) {
          try {
            await req.payload.create({
              collection: 'search',
              data: {
                doc: { value: page.id, relationTo: 'pages' },
                priority: 10,
              },
            })
            reindexed++
          } catch (err) {
            reindexErrors.push({ pageId: page.id, error: err instanceof Error ? err.message : String(err) })
          }
        }
      } catch (err) {
        return text(
          JSON.stringify(
            { success: false, error: 'Reindex phase failed', details: err instanceof Error ? err.message : String(err) },
            null,
            2,
          ),
        )
      }

      return text(
        JSON.stringify(
          {
            success: reindexErrors.length === 0,
            deleted: deletedCount,
            deleteErrors: deleteErrors.length > 0 ? deleteErrors : undefined,
            reindexed,
            reindexErrors: reindexErrors.length > 0 ? reindexErrors : undefined,
          },
          null,
          2,
        ) + truncationWarning,
      )
    },
  },
  {
    name: 'create_redirect',
    description: 'Create a redirect document from one URL to another.',
    parameters: {
      from: z.string(),
      to: z.string(),
      type: z.string().optional(),
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      const from = args.from as string
      const to = args.to as string
      const type = (args.type as string | undefined) ?? '301'

      if (!from.startsWith('/')) {
        return text(JSON.stringify({ success: false, error: '`from` must start with a `/`' }, null, 2))
      }
      if (!to || to.trim() === '') {
        return text(JSON.stringify({ success: false, error: '`to` must be non-empty' }, null, 2))
      }

      try {
        const redirect = await req.payload.create({
          collection: 'redirects',
          data: {
            from,
            to: {
              type: 'custom',
              url: to,
            },
            type,
          },
        })

        return text(JSON.stringify({ success: true, id: redirect.id, from, to, type }, null, 2))
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(JSON.stringify({ success: false, error: message }, null, 2))
      }
    },
  },
  {
    name: 'bulk_import_redirects',
    description: 'Parse a JSON array of redirects and create each one. Input should be a JSON string of [{ from, to, type? }].',
    parameters: {
      redirects: z.string(),
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      let entries: Array<{ from: string; to: string; type?: string }>

      try {
        entries = JSON.parse(args.redirects as string)
      } catch {
        return text(JSON.stringify({ success: false, error: 'Invalid JSON: could not parse redirects string' }, null, 2))
      }

      // Fix #2 & #3: Per-entry error handling and pass `type` to each redirect
      const successes: Array<{ index: number; from: string; to: string; id: unknown }> = []
      const failures: Array<{ index: number; from: string; to: string; error: string }> = []

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]
        const type = entry.type ?? '301'

        try {
          const created = await req.payload.create({
            collection: 'redirects',
            data: {
              from: entry.from,
              to: {
                type: 'custom',
                url: entry.to,
              },
              type,
            },
          })
          successes.push({ index: i, from: entry.from, to: entry.to, id: created.id })
        } catch (err) {
          failures.push({
            index: i,
            from: entry.from,
            to: entry.to,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      return text(
        JSON.stringify(
          {
            success: failures.length === 0,
            created: successes.length,
            failed: failures.length,
            successes,
            failures: failures.length > 0 ? failures : undefined,
          },
          null,
          2,
        ),
      )
    },
  },
]

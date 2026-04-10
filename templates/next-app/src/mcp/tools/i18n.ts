import { z } from 'zod'
import type { PayloadRequest } from 'payload'

const text = (t: string) => ({ content: [{ text: t, type: 'text' as const }] })

const LOCALES = ['en', 'es', 'fr']

export const i18nTools = [
  {
    name: 'translation_coverage',
    description: 'Report translation coverage for all locales. For each locale, counts published pages with vs without a translated title.',
    parameters: {},
    handler: async (_args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const report: Record<string, { total: number; translated: number }> = {}
        const warnings: string[] = []

        for (const loc of LOCALES) {
          const result = await req.payload.find({
            collection: 'pages',
            locale: loc as 'en' | 'es' | 'fr',
            where: { _status: { equals: 'published' } },
            limit: 1000,
          })

          if (result.totalDocs > result.docs.length) {
            warnings.push(`Warning (${loc}): ${result.totalDocs} total pages, showing first ${result.docs.length}.`)
          }

          const total = result.docs.length
          const translated = result.docs.filter((page: Record<string, unknown>) => {
            const title = page.title
            return typeof title === 'string' && title.trim().length > 0
          }).length

          report[loc] = { total, translated }
        }

        const warningStr = warnings.length > 0 ? '\n' + warnings.join('\n') : ''
        return text(JSON.stringify(report, null, 2) + warningStr)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
  {
    name: 'find_untranslated_fields',
    description: 'Find which fields are empty or null for a specific page and locale. Checks: title, content, excerpt, meta.title, meta.description.',
    parameters: {
      id: z.string(),
      locale: z.string(),
    },
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const id = args.id as string
        const locale = args.locale as string

        const page = await req.payload.findByID({
          collection: 'pages',
          id,
          locale: locale as 'en' | 'es' | 'fr',
        }) as Record<string, unknown>

        const meta = (page.meta ?? {}) as Record<string, unknown>

        const fields: Record<string, string> = {
          title: typeof page.title === 'string' && page.title.trim().length > 0 ? 'present' : 'empty',
          content: page.content != null && page.content !== '' ? 'present' : 'empty',
          excerpt: typeof page.excerpt === 'string' && page.excerpt.trim().length > 0 ? 'present' : 'empty',
          'meta.title': typeof meta.title === 'string' && meta.title.trim().length > 0 ? 'present' : 'empty',
          'meta.description': typeof meta.description === 'string' && meta.description.trim().length > 0 ? 'present' : 'empty',
        }

        const report = {
          id,
          locale,
          fields,
          untranslated: Object.entries(fields)
            .filter(([, status]) => status === 'empty')
            .map(([field]) => field),
        }

        return text(JSON.stringify(report, null, 2))
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
]

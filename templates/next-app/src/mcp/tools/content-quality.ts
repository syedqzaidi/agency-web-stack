import { z } from 'zod'
import type { PayloadRequest } from 'payload'

const text = (t: string) => ({ content: [{ text: t, type: 'text' as const }] })

function extractLexicalText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  // Leaf text node — extract the actual text value
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  // Recurse into children array
  if (Array.isArray(n.children)) {
    return (n.children as unknown[]).map(extractLexicalText).join(' ')
  }
  // Root / editor state wrapper: try common top-level keys
  const rootKeys = ['root', 'editorState']
  for (const key of rootKeys) {
    if (key in n) return extractLexicalText(n[key])
  }
  return ''
}

function estimateWordCount(content: unknown): number {
  if (!content) return 0
  const extracted = extractLexicalText(content).trim()
  if (!extracted) return 0
  return extracted.split(/\s+/).filter(Boolean).length
}

function countHeadings(content: unknown): number {
  if (!content) return 0
  const str = JSON.stringify(content)
  const matches = str.match(/"type"\s*:\s*"heading"/g)
  return matches ? matches.length : 0
}

export const contentQualityTools = [
  {
    name: 'content_stats',
    description: 'Get word count, reading time, and heading count for a page by ID.',
    parameters: { id: z.string() },
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const id = args.id as string
        const page = await req.payload.findByID({ collection: 'pages', id }) as Record<string, unknown>
        const content = page.content
        const wordCount = estimateWordCount(content)
        const readingTime = Math.ceil(wordCount / 200)
        const headingCount = countHeadings(content)
        const stats = {
          id,
          title: page.title ?? null,
          wordCount,
          readingTime,
          headingCount,
        }
        return text(JSON.stringify(stats, null, 2))
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
  {
    name: 'find_orphan_pages',
    description: 'Find published pages that have no parent and are not referenced as a parent by any other page.',
    parameters: {},
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const result = await req.payload.find({
          collection: 'pages',
          where: { _status: { equals: 'published' } },
          limit: 500,
          depth: 1,
        })
        const pages = result.docs as Record<string, unknown>[]
        const warning = result.totalDocs > result.docs.length
          ? `\nWarning: ${result.totalDocs} total items, showing first ${result.docs.length}.`
          : ''

        // Collect all parent IDs referenced by any page
        const referencedAsParent = new Set<string>()
        for (const page of pages) {
          const parent = page.parent
          if (parent) {
            const parentId = typeof parent === 'object' && parent !== null
              ? String((parent as Record<string, unknown>).id ?? parent)
              : String(parent)
            referencedAsParent.add(parentId)
          }
        }

        // Exclude common root pages that are intentionally parentless
        const rootSlugs = new Set(['home', '', 'index'])

        const orphans = pages
          .filter((page) => {
            const parent = page.parent
            const hasNoParent = parent === null || parent === undefined
            const id = String(page.id)
            const slug = typeof page.slug === 'string' ? page.slug : ''
            const isNotReferencedAsParent = !referencedAsParent.has(id)
            const isNotRootPage = !rootSlugs.has(slug)
            return hasNoParent && isNotReferencedAsParent && isNotRootPage
          })
          .map((page) => ({ id: page.id, title: page.title, slug: page.slug }))

        return text(JSON.stringify(orphans, null, 2) + warning)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
  {
    name: 'find_thin_content',
    description: 'Find published pages with word count below a threshold (default 300).',
    parameters: { minWords: z.number().optional() },
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const minWords = (args.minWords as number | undefined) ?? 300
        const result = await req.payload.find({
          collection: 'pages',
          where: { _status: { equals: 'published' } },
          limit: 500,
          depth: 0,
        })
        const pages = result.docs as Record<string, unknown>[]
        const warning = result.totalDocs > result.docs.length
          ? `\nWarning: ${result.totalDocs} total items, showing first ${result.docs.length}.`
          : ''

        const thin = pages
          .map((page) => ({
            id: page.id,
            title: page.title,
            slug: page.slug,
            wordCount: estimateWordCount(page.content),
          }))
          .filter((page) => page.wordCount < minWords)
          .sort((a, b) => a.wordCount - b.wordCount)

        return text(JSON.stringify(thin, null, 2) + warning)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
  {
    name: 'check_broken_links',
    description: 'Check all URLs found in a page\'s content for broken links (4xx/5xx responses).',
    parameters: { id: z.string() },
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const id = args.id as string
        const page = await req.payload.findByID({ collection: 'pages', id }) as Record<string, unknown>
        const contentStr = JSON.stringify(page.content ?? '')
        const urlRegex = /https?:\/\/[^\s"'<>]+/g
        const allUrls = contentStr.match(urlRegex) ?? []
        const uniqueUrls = [...new Set(allUrls)].slice(0, 20)

        const fetchOne = async (url: string): Promise<{ url: string; status: number | string; broken: boolean }> => {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 5000)
          try {
            const response = await fetch(url, {
              method: 'HEAD',
              signal: controller.signal,
              redirect: 'follow',
            })
            clearTimeout(timeout)
            return { url, status: response.status, broken: response.status >= 400 }
          } catch {
            clearTimeout(timeout)
            return { url, status: controller.signal.aborted ? 'timeout' : 'error', broken: true }
          }
        }

        const settled = await Promise.allSettled(uniqueUrls.map(fetchOne))
        const results = settled.map((outcome) =>
          outcome.status === 'fulfilled'
            ? outcome.value
            : { url: '', status: 'error', broken: true },
        )

        const broken = results.filter((r) => r.broken)
        const report = {
          pageId: id,
          title: page.title,
          totalLinksChecked: results.length,
          brokenCount: broken.length,
          brokenLinks: broken,
          allResults: results,
        }

        return text(JSON.stringify(report, null, 2))
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
  {
    name: 'site_health_check',
    description: 'Aggregate site health: counts of pages missing SEO fields, thin content, and orphan pages.',
    parameters: {},
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const result = await req.payload.find({
          collection: 'pages',
          where: { _status: { equals: 'published' } },
          limit: 500,
          depth: 1,
        })
        const pages = result.docs as Record<string, unknown>[]
        const warning = result.totalDocs > result.docs.length
          ? `\nWarning: ${result.totalDocs} total items, showing first ${result.docs.length}.`
          : ''

        const MIN_WORDS = 300

        // Count missing SEO
        let missingSeo = 0
        for (const page of pages) {
          const meta = page.meta as Record<string, unknown> | undefined
          const missingTitle = !meta?.title || (meta.title as string).trim() === ''
          const missingDesc = !meta?.description || (meta.description as string).trim() === ''
          if (missingTitle || missingDesc) missingSeo++
        }

        // Count thin content
        let thinCount = 0
        for (const page of pages) {
          const wc = estimateWordCount(page.content)
          if (wc < MIN_WORDS) thinCount++
        }

        // Count orphans
        const referencedAsParent = new Set<string>()
        for (const page of pages) {
          const parent = page.parent
          if (parent) {
            const parentId = typeof parent === 'object' && parent !== null
              ? String((parent as Record<string, unknown>).id ?? parent)
              : String(parent)
            referencedAsParent.add(parentId)
          }
        }
        const rootSlugs = new Set(['home', '', 'index'])
        let orphanCount = 0
        for (const page of pages) {
          const hasNoParent = page.parent === null || page.parent === undefined
          const id = String(page.id)
          const slug = typeof page.slug === 'string' ? page.slug : ''
          if (hasNoParent && !referencedAsParent.has(id) && !rootSlugs.has(slug)) orphanCount++
        }

        const summary = {
          totalPublishedPages: pages.length,
          pagesMissingSeoFields: missingSeo,
          thinContentPages: thinCount,
          orphanPages: orphanCount,
        }

        return text(JSON.stringify(summary, null, 2) + warning)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
  {
    name: 'content_inventory',
    description: 'List all pages (any status) with title, slug, status, word count estimate, locale, and SEO field presence.',
    parameters: {},
    handler: async (args: Record<string, unknown>, req: PayloadRequest, _extra: unknown) => {
      try {
        const result = await req.payload.find({
          collection: 'pages',
          limit: 500,
          depth: 0,
        })
        const pages = result.docs as Record<string, unknown>[]
        const warning = result.totalDocs > result.docs.length
          ? `\nWarning: ${result.totalDocs} total items, showing first ${result.docs.length}.`
          : ''

        const inventory = pages.map((page) => {
          const meta = page.meta as Record<string, unknown> | undefined
          return {
            id: page.id,
            title: page.title ?? null,
            slug: page.slug ?? null,
            status: page._status ?? null,
            wordCount: estimateWordCount(page.content),
            locale: page.locale ?? null,
            hasMetaTitle: !!(meta?.title && (meta.title as string).trim() !== ''),
            hasMetaDescription: !!(meta?.description && (meta.description as string).trim() !== ''),
          }
        })

        return text(JSON.stringify(inventory, null, 2) + warning)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return text(`Error: ${message}`)
      }
    },
  },
]

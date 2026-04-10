import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { searchPlugin } from '@payloadcms/plugin-search'
import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import { s3Storage } from '@payloadcms/storage-s3'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import { sentryPlugin } from '@payloadcms/plugin-sentry'
import * as Sentry from '@sentry/nextjs'
import { stripePlugin } from '@payloadcms/plugin-stripe'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { payloadAiPlugin } from '@ai-stack/payloadcms'
// NOTE: @payload-enchants packages (v1.2.2) are incompatible with Payload 3.82.x
// They import removed exports from @payloadcms/ui (useListInfo, useFieldProps).
// Re-enable when upstream releases compatible versions.
// import { betterLocalizedFields } from '@payload-enchants/better-localized-fields'
// import { docsReorder } from '@payload-enchants/docs-reorder'
// import { buildCachedPayload } from '@payload-enchants/cached-local-api'
import type { Plugin } from 'payload'

export function getPlugins(): Plugin[] {
  const plugins: Plugin[] = []

  plugins.push(
    nestedDocsPlugin({
      collections: ['pages'],
      generateLabel: (_, doc) => doc.title as string,
      generateURL: (docs) =>
        docs.reduce((url, doc) => `${url}/${doc.slug}`, ''),
    }),
  )

  plugins.push(
    seoPlugin({
      collections: ['pages'],
      uploadsCollection: 'media',
      tabbedUI: true,

      generateTitle: ({ doc }) =>
        `${(doc as any)?.title || ''} | ${process.env.NEXT_PUBLIC_SITE_NAME || 'Site Name'}`,

      // Use excerpt if available, otherwise fall back to title
      generateDescription: ({ doc }) => {
        const d = doc as any
        return d?.excerpt || d?.title || ''
      },

      // Locale-aware canonical URL
      generateURL: ({ doc, locale }) => {
        const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || ''
        const slug = (doc as any)?.slug || ''
        const localePrefix = locale && locale !== 'en' ? `/${locale}` : ''
        return `${baseUrl}${localePrefix}/${slug}`
      },

      // Auto-populate OG image from the page's featured image
      generateImage: ({ doc }) => (doc as any)?.featuredImage,

      // Extend default meta fields with robots, OG title, and JSON-LD
      fields: ({ defaultFields }) => [
        ...defaultFields,
        {
          name: 'ogTitle',
          type: 'text',
          label: 'OG Title (Social)',
          admin: {
            description: 'Override the title shown on social cards. Falls back to meta title if empty.',
          },
        },
        {
          name: 'robots',
          type: 'select',
          label: 'Robots',
          defaultValue: 'index, follow',
          options: [
            { label: 'Index, Follow (default)', value: 'index, follow' },
            { label: 'No Index, Follow', value: 'noindex, follow' },
            { label: 'Index, No Follow', value: 'index, nofollow' },
            { label: 'No Index, No Follow', value: 'noindex, nofollow' },
          ],
          admin: {
            description: 'Control how search engines index and follow links on this page.',
          },
        },
        {
          name: 'jsonLd',
          type: 'json',
          label: 'JSON-LD Schema',
          admin: {
            description: 'Structured data (schema.org) for rich search results. Paste valid JSON-LD.',
          },
        },
      ],
    }),
  )

  plugins.push(
    redirectsPlugin({
      collections: ['pages'],
      redirectTypes: ['301', '302'],
      overrides: {
        admin: { group: 'Content' },
      },
    }),
  )

  plugins.push(
    searchPlugin({
      collections: ['pages'],
      defaultPriorities: {
        pages: 10,
      },
      syncDrafts: false,
      deleteDrafts: true,
    }),
  )

  plugins.push(
    formBuilderPlugin({
      fields: {
        text: true,
        textarea: true,
        select: true,
        email: true,
        number: true,
        checkbox: true,
        message: true,
      },
      redirectRelationships: ['pages'],
      formOverrides: {
        admin: { group: 'Forms' },
      },
      formSubmissionOverrides: {
        admin: { group: 'Forms' },
      },
    }),
  )

  plugins.push(
    importExportPlugin({
      collections: [
        { slug: 'pages' },
        { slug: 'media' },
      ],
    }),
  )

  // Storage adapters — conditional on environment variables
  if (process.env.S3_BUCKET) {
    plugins.push(
      s3Storage({
        collections: { media: true },
        bucket: process.env.S3_BUCKET,
        config: {
          region: process.env.S3_REGION || 'us-east-1',
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
          },
          ...(process.env.S3_ENDPOINT && {
            endpoint: process.env.S3_ENDPOINT,
            forcePathStyle: true,
          }),
        },
      }),
    )
  } else if (process.env.BLOB_READ_WRITE_TOKEN) {
    plugins.push(
      vercelBlobStorage({
        collections: { media: true },
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }),
    )
  }

  // Stripe plugin — conditional on environment variable
  if (process.env.STRIPE_SECRET_KEY) {
    plugins.push(
      stripePlugin({
        stripeSecretKey: process.env.STRIPE_SECRET_KEY,
        stripeWebhooksEndpointSecret: process.env.STRIPE_WEBHOOKS_ENDPOINT_SECRET,
        rest: false,
        logs: process.env.NODE_ENV !== 'production',
        sync: [
          {
            collection: 'users',
            stripeResourceType: 'customers',
            stripeResourceTypeSingular: 'customer',
            fields: [
              { fieldPath: 'email', stripeProperty: 'email' },
              { fieldPath: 'name', stripeProperty: 'name' },
            ],
          },
        ],
      }),
    )
  }

  // MCP plugin — exposes Payload CMS via Model Context Protocol
  plugins.push(mcpPlugin({}))

  // AI plugin — activates when any supported AI provider key is set
  const hasAiProvider =
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY

  if (hasAiProvider) {
    plugins.push(
      payloadAiPlugin({
        // Enable AI on pages (text compose, proofread, translate, rephrase, expand, simplify, summarize)
        collections: {
          pages: true,
        },

        // Route generated images to the media collection
        uploadCollectionSlug: 'media',

        // Access control — editors+ can generate, only admins can edit AI settings/prompts
        access: {
          generate: ({ req }) =>
            req.user?.role === 'admin' || req.user?.role === 'editor',
          settings: ({ req }) => req.user?.role === 'admin',
        },

        // Lock translation languages to match our i18n config (en/es/fr)
        options: {
          enabledLanguages: ['en-US', 'es', 'fr'],
        },

        // Auto-populate AI prompts for SEO and content fields
        seedPrompts: ({ path }) => {
          if (path.endsWith('.meta.title')) {
            return {
              data: {
                prompt:
                  'Generate an SEO-optimized page title (50-60 chars) for: {{ title }}',
              },
            }
          }
          if (path.endsWith('.meta.description')) {
            return {
              data: {
                prompt:
                  'Generate an SEO meta description (150-160 chars). Title: {{ title }}. Excerpt: {{ excerpt }}',
              },
            }
          }
          if (path.endsWith('.meta.ogTitle')) {
            return {
              data: {
                prompt:
                  'Generate a compelling social media title (60-90 chars) that drives clicks. Title: {{ title }}',
              },
            }
          }
          if (path.endsWith('.excerpt')) {
            return {
              data: {
                prompt:
                  'Write a concise excerpt (150-160 chars) summarizing this page for search results. Title: {{ title }}',
              },
            }
          }
          if (path.endsWith('.slug')) return false // Disable AI for slugs
          if (path.endsWith('.meta.robots')) return false // Disable AI for robots
          if (path.endsWith('.meta.jsonLd')) return false // Disable AI for JSON-LD
          return undefined // Use default prompts for everything else
        },

        debugging: process.env.NODE_ENV !== 'production',
      }),
    )
  }

  // Enchants plugins — disabled due to Payload 3.82.x incompatibility.
  // Re-enable when @payload-enchants releases compatible versions.
  // const { cachedPayloadPlugin } = buildCachedPayload({
  //   collections: [{ slug: 'pages' }, { slug: 'media' }, { slug: 'users' }],
  //   revalidateTag: () => {},
  //   unstable_cache: (cb: any) => cb,
  // })
  // plugins.push(
  //   betterLocalizedFields(),
  //   docsReorder({ collections: [{ slug: 'pages' }] }),
  //   cachedPayloadPlugin,
  // )

  // Sentry plugin — unshifted to be first in array so it wraps all other operations
  plugins.unshift(
    sentryPlugin({
      Sentry,
      options: {
        captureErrors: [400, 403, 404, 500],
        context: ({ defaultContext, req }) => ({
          ...defaultContext,
          tags: {
            locale: req.locale || 'en',
          },
        }),
      },
    }),
  )

  return plugins
}

import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { searchPlugin } from '@payloadcms/plugin-search'
import { formBuilderPlugin, getPaymentTotal } from '@payloadcms/plugin-form-builder'
import { importExportPlugin } from '@payloadcms/plugin-import-export'
import { s3Storage } from '@payloadcms/storage-s3'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import { sentryPlugin } from '@payloadcms/plugin-sentry'
import * as Sentry from '@sentry/nextjs'
import { stripePlugin } from '@payloadcms/plugin-stripe'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { mcpConfig } from '../mcp'
import { payloadAiPlugin } from '@ai-stack/payloadcms'
// NOTE: @payload-enchants packages (v1.2.2) are incompatible with Payload 3.82.x
// They import removed exports from @payloadcms/ui (useListInfo, useFieldProps).
// Re-enable when upstream releases compatible versions.
// import { betterLocalizedFields } from '@payload-enchants/better-localized-fields'
// import { docsReorder } from '@payload-enchants/docs-reorder'
// import { buildCachedPayload } from '@payload-enchants/cached-local-api'
import { twentyCrmPlugin } from './twenty-crm'
import type { Plugin } from 'payload'

export function getPlugins(): Plugin[] {
  const plugins: Plugin[] = []

  plugins.push(
    nestedDocsPlugin({
      collections: ['pages', 'services'],
      generateLabel: (_, doc) => String((doc as any).title || (doc as any).name),
      generateURL: (docs) =>
        docs.reduce((url, doc) => `${url}/${doc.slug}`, ''),
    }),
  )

  plugins.push(
    seoPlugin({
      collections: ['pages', 'services', 'locations', 'service-pages', 'blog-posts'],
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
      collections: ['pages', 'services', 'locations', 'service-pages', 'blog-posts'],
      redirectTypes: ['301', '302'],
      overrides: {
        admin: { group: 'Content' },
      },
    }),
  )

  plugins.push(
    searchPlugin({
      collections: ['pages', 'services', 'locations', 'service-pages', 'blog-posts'],
      defaultPriorities: {
        pages: 10,
        services: 20,
        locations: 30,
        'service-pages': 10,
        'blog-posts': 40,
      },
      syncDrafts: false,
      deleteDrafts: true,
    }),
  )

  plugins.push(
    formBuilderPlugin({
      // All 12 field types enabled
      fields: {
        text: true,
        textarea: true,
        select: true,
        radio: true,
        email: true,
        state: true,
        country: true,
        checkbox: true,
        number: true,
        message: true,
        date: true,
        payment: true,
      },
      redirectRelationships: ['pages'],

      // Wrap emails in a branded HTML template before sending
      beforeEmail: (emailsToSend) => {
        const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'Site Name'
        return emailsToSend.map((email) => ({
          ...email,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px;">
                <h2 style="margin: 0; color: #111827;">${siteName}</h2>
              </div>
              <div style="color: #374151; line-height: 1.6;">
                ${email.html}
              </div>
              <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 32px; font-size: 12px; color: #9ca3af;">
                This email was sent from ${siteName}. Please do not reply directly to this email.
              </div>
            </div>
          `,
        }))
      },

      // Process payments via Stripe when a payment field is submitted
      handlePayment: process.env.STRIPE_SECRET_KEY
        ? async ({ form, submissionData }) => {
            const paymentField = (form.fields as any[])?.find(
              (field) => field.blockType === 'payment',
            )
            if (!paymentField) return

            const price = getPaymentTotal({
              basePrice: paymentField.basePrice,
              priceConditions: paymentField.priceConditions,
              fieldValues: submissionData,
            })

            // Import Stripe dynamically to avoid requiring it when not configured
            const Stripe = (await import('stripe')).default
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
              apiVersion: '2022-08-01',
            })

            await stripe.paymentIntents.create({
              amount: Math.round(price * 100), // Stripe expects cents
              currency: 'usd',
              metadata: {
                formId: typeof form.id === 'string' ? form.id : String(form.id),
                formTitle: (form as any).title || '',
              },
            })
          }
        : undefined,

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
        { slug: 'services' },
        { slug: 'locations' },
        { slug: 'service-pages' },
        { slug: 'blog-posts' },
        { slug: 'faqs' },
        { slug: 'testimonials' },
        { slug: 'team-members' },
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

  // Twenty CRM plugin — conditional on environment variables
  if (process.env.TWENTY_API_URL && process.env.TWENTY_API_KEY) {
    plugins.push(
      twentyCrmPlugin({
        apiUrl: process.env.TWENTY_API_URL,
        apiKey: process.env.TWENTY_API_KEY,
        logs: process.env.NODE_ENV !== 'production',
        sync: [
          {
            collection: 'form-submissions',
            formSubmission: true,
            targets: [
              {
                object: 'people',
                fields: [
                  { sourceField: 'email', targetField: 'emails.primaryEmail' },
                  {
                    sourceField: 'firstName',
                    targetField: 'name.firstName',
                    transform: (v) => String(v || ''),
                  },
                  {
                    sourceField: 'lastName',
                    targetField: 'name.lastName',
                    transform: (v) => String(v || ''),
                  },
                  { sourceField: 'phone', targetField: 'phones.primaryPhoneNumber' },
                  { sourceField: 'jobTitle', targetField: 'jobTitle' },
                ],
              },
              {
                object: 'notes',
                bodyField: 'message',
                linkToPersonByEmail: 'email',
                fields: [
                  {
                    sourceField: '_formTitle',
                    targetField: 'title',
                    transform: (v) => `Form: ${v || 'Submission'}`,
                  },
                ],
              },
            ],
          },
          {
            collection: 'users',
            condition: (doc) => doc.role === 'admin' || doc.role === 'editor',
            targets: [
              {
                object: 'people',
                fields: [
                  { sourceField: 'email', targetField: 'emails.primaryEmail' },
                  { sourceField: 'name', targetField: 'name.firstName' },
                ],
              },
            ],
          },
        ],
      }),
    )
  }

  // MCP plugin — exposes Payload CMS via Model Context Protocol
  // Configured with 33 custom tools, 5 prompts, and granular collection permissions
  plugins.push(mcpPlugin(mcpConfig))

  // AI plugin — conditional on having at least one AI provider key
  // Without a key the plugin slows Payload to a crawl (30s+ responses)
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

      // Disable prompt generation at startup — avoids hanging when provider is slow/unreachable
      generatePromptOnInit: false,

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
  if (process.env.SENTRY_DSN) {
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
  }

  return plugins
}

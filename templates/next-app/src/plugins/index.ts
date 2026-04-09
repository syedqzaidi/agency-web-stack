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
        `${doc.title as string} | ${process.env.NEXT_PUBLIC_SITE_NAME || 'Site Name'}`,
      generateDescription: ({ doc }) =>
        (doc.title as string) || '',
      generateURL: ({ doc }) =>
        `${process.env.NEXT_PUBLIC_SERVER_URL || ''}/${(doc as any).slug || ''}`,
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

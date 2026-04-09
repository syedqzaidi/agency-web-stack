import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { redirectsPlugin } from '@payloadcms/plugin-redirects'
import { seoPlugin } from '@payloadcms/plugin-seo'
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
        `${doc.title as string} | Site Name`,
      generateDescription: ({ doc }) =>
        (doc.title as string) || '',
      generateURL: ({ doc }) =>
        `${process.env.NEXT_PUBLIC_SERVER_URL || ''}/${(doc as any).slug || ''}`,
    }),
  )

  plugins.push(
    redirectsPlugin({
      collections: ['pages'],
      overrides: {
        admin: { group: 'Content' },
      },
    }),
  )

  return plugins
}

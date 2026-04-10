import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { resendAdapter } from '@payloadcms/email-resend'
import { Pages, Media, Users } from './collections'
import { getPlugins } from './plugins'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
    user: 'users',
    livePreview: {
      url: ({ data, collectionConfig, locale }) => {
        const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3100'
        const slug = (data as any)?.slug || ''
        const localeParam = locale?.code && locale.code !== 'en' ? `?locale=${locale.code}` : ''
        if (collectionConfig?.slug === 'pages') {
          return `${baseUrl}/${slug}${localeParam}`
        }
        return baseUrl
      },
      collections: ['pages'],
      breakpoints: [
        { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
        { label: 'Tablet', name: 'tablet', width: 768, height: 1024 },
        { label: 'Desktop', name: 'desktop', width: 1440, height: 900 },
      ],
    },
  },
  localization: {
    locales: [
      { label: 'English', code: 'en' },
      { label: 'Spanish', code: 'es' },
      { label: 'French', code: 'fr' },
    ],
    defaultLocale: 'en',
    fallback: true,
  },
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || '',
  collections: [Pages, Media, Users],
  plugins: getPlugins(),
  editor: lexicalEditor(),
  // Email via Resend — required for form builder emails and auth (password reset, etc.)
  ...(process.env.RESEND_API_KEY && {
    email: resendAdapter({
      defaultFromAddress: process.env.EMAIL_FROM_ADDRESS || 'noreply@example.com',
      defaultFromName: process.env.NEXT_PUBLIC_SITE_NAME || 'Site Name',
      apiKey: process.env.RESEND_API_KEY,
    }),
  }),
  secret: process.env.PAYLOAD_SECRET || (process.env.NODE_ENV === 'production'
    ? (() => { throw new Error('PAYLOAD_SECRET is required in production') })()
    : 'dev-secret-do-not-use-in-production'),
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      // DATABASE_URL is set by init-project.sh with the correct port.
      // No fallback — if missing, Payload should fail immediately rather than
      // silently connecting to the wrong port.
      connectionString: process.env.DATABASE_URL || (() => {
        throw new Error(
          'DATABASE_URL is not set. Run ./scripts/init-project.sh or check your .env.local file.',
        )
      })(),
    },
  }),
})

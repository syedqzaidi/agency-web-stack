/**
 * Seed AI plugin instruction records for all enabled collections.
 * Run after server starts: curl http://localhost:3100/api/seed-ai-instructions
 *
 * This avoids the slow generatePromptOnInit which calls OpenAI for each field.
 * Instead, we create records directly with sensible default prompts.
 */

import type { Payload } from 'payload'

const COLLECTION = 'plugin-ai-instructions'

interface FieldDef {
  schemaPath: string
  fieldType: 'text' | 'textarea' | 'richText' | 'upload'
  prompt: string
  modelId?: string
}

// All text/textarea/richText/upload fields across enabled collections
const fields: FieldDef[] = [
  // Pages
  { schemaPath: 'pages.title', fieldType: 'text', prompt: 'Generate a compelling page title for: {{ title }}' },
  { schemaPath: 'pages.excerpt', fieldType: 'textarea', prompt: 'Write a concise summary (150-160 chars) for the page: {{ title }}' },
  { schemaPath: 'pages.content', fieldType: 'richText', prompt: 'Create engaging page content for: {{ title }}' },
  { schemaPath: 'pages.featuredImage', fieldType: 'upload', prompt: 'Imagine {{ title }}' },

  // Blog Posts
  { schemaPath: 'blog-posts.title', fieldType: 'text', prompt: 'Generate a captivating blog title for: {{ title }}' },
  { schemaPath: 'blog-posts.excerpt', fieldType: 'textarea', prompt: 'Write a compelling blog excerpt (150-160 chars) for: {{ title }}' },
  { schemaPath: 'blog-posts.content', fieldType: 'richText', prompt: 'Write an engaging blog post about: {{ title }}. Include an introduction, clear sections with subheadings, and a conclusion.' },
  { schemaPath: 'blog-posts.featuredImage', fieldType: 'upload', prompt: 'Imagine {{ title }}' },

  // Services
  { schemaPath: 'services.name', fieldType: 'text', prompt: 'Generate a professional service name based on: {{ title }}' },
  { schemaPath: 'services.tagline', fieldType: 'text', prompt: 'Write a short tagline for the service: {{ title }}' },
  { schemaPath: 'services.excerpt', fieldType: 'textarea', prompt: 'Write a brief service description (150-160 chars) for: {{ title }}' },
  { schemaPath: 'services.description', fieldType: 'richText', prompt: 'Write a detailed service description for: {{ title }}. Include benefits, process, and what customers can expect.' },
  { schemaPath: 'services.featuredImage', fieldType: 'upload', prompt: 'Imagine {{ title }}' },

  // Locations
  { schemaPath: 'locations.name', fieldType: 'text', prompt: 'Format the location name: {{ title }}' },
  { schemaPath: 'locations.description', fieldType: 'richText', prompt: 'Write a description for the {{ title }} service area. Include local details and what makes this area unique.' },

  // Service Pages
  { schemaPath: 'service-pages.customTitle', fieldType: 'text', prompt: 'Generate an SEO-optimized title combining service and location: {{ title }}' },
  { schemaPath: 'service-pages.introduction', fieldType: 'richText', prompt: 'Write an introduction for {{ title }} that highlights local expertise.' },
  { schemaPath: 'service-pages.localContent', fieldType: 'richText', prompt: 'Write location-specific content for {{ title }}. Include local regulations, tips, and area-specific information.' },

  // FAQs
  { schemaPath: 'faqs.question', fieldType: 'text', prompt: 'Generate a clear FAQ question about: {{ title }}' },
  { schemaPath: 'faqs.answer', fieldType: 'richText', prompt: 'Write a helpful, concise answer to the question: {{ title }}' },

  // Testimonials
  { schemaPath: 'testimonials.quote', fieldType: 'textarea', prompt: 'Write a realistic customer testimonial about: {{ title }}' },
  { schemaPath: 'testimonials.clientName', fieldType: 'text', prompt: 'Generate a realistic client name' },

  // Team Members
  { schemaPath: 'team-members.name', fieldType: 'text', prompt: 'Format the team member name: {{ title }}' },
  { schemaPath: 'team-members.role', fieldType: 'text', prompt: 'Generate a professional job title for: {{ title }}' },
  { schemaPath: 'team-members.bio', fieldType: 'richText', prompt: 'Write a professional bio for {{ title }}. Include experience, expertise, and a personal touch.' },
]

export async function seedAiInstructions(payload: Payload): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  for (const field of fields) {
    // Check if record already exists
    const existing = await payload.find({
      collection: COLLECTION,
      where: { 'schema-path': { equals: field.schemaPath } },
      limit: 1,
      locale: 'all',
    })

    if (existing.docs.length > 0) {
      skipped++
      continue
    }

    // Determine default model based on field type
    let modelId = 'Oai-text' // default for text/textarea
    if (field.fieldType === 'richText') modelId = 'Oai-object'
    if (field.fieldType === 'upload') modelId = 'dall-e'
    if (field.modelId) modelId = field.modelId

    try {
      await payload.create({
        collection: COLLECTION,
        data: {
          'schema-path': field.schemaPath,
          'field-type': field.fieldType,
          'model-id': modelId,
          prompt: field.prompt,
          ...(field.fieldType === 'upload' ? { 'relation-to': 'media' } : {}),
        },
      })
      created++
      payload.logger.info(`Seeded AI prompt for: ${field.schemaPath}`)
    } catch (err) {
      payload.logger.error(`Failed to seed ${field.schemaPath}: ${err}`)
    }
  }

  return { created, skipped }
}

import type {
  PayloadListResponse,
  PayloadClient,
  PayloadClientConfig,
  Service,
  Location,
  ServicePage,
  BlogPost,
  FAQ,
  Testimonial,
  TeamMember,
  Page,
  SiteSettings,
} from './types'

export function createPayloadClient(config: PayloadClientConfig): PayloadClient {
  const { apiKey, defaultDepth = 1, authCollection = 'users' } = config
  const apiUrl = config.apiUrl.replace(/\/+$/, '')
  const timeout = config.timeout ?? 60_000

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['Authorization'] = `${authCollection} API-Key ${apiKey}`
  }

  async function fetchPayload<T>(
    endpoint: string,
    params?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${apiUrl}/${endpoint}`)
    if (params) {
      Object.entries(params).forEach(([key, value]) =>
        url.searchParams.set(key, value),
      )
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetch(url.toString(), { headers, signal: controller.signal })

      if (!response.ok) {
        throw new Error(
          `Payload API error: ${response.status} ${response.statusText} at ${endpoint}`,
        )
      }
      return response.json()
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async function fetchList<T>(
    collection: string,
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<T>> {
    const result = await fetchPayload<PayloadListResponse<T>>(collection, {
      depth: String(defaultDepth),
      ...params,
    })
    if (!result || !Array.isArray(result.docs)) {
      throw new Error(`Payload API returned invalid list response for ${collection}`)
    }
    return result
  }

  async function fetchById<T>(
    collection: string,
    id: string,
    depth?: number,
  ): Promise<T> {
    return fetchPayload<T>(`${collection}/${id}`, {
      depth: String(depth ?? defaultDepth),
    })
  }

  async function fetchBySlug<T>(
    collection: string,
    slug: string,
    depth?: number,
    draft?: boolean,
  ): Promise<T | null> {
    const params: Record<string, string> = {
      'where[slug][equals]': slug,
      depth: String(depth ?? defaultDepth),
    }
    if (draft) params.draft = 'true'
    const result = await fetchList<T>(collection, params)
    return result.docs[0] ?? null
  }

  async function fetchPublished<T>(
    collection: string,
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<T>> {
    return fetchList<T>(collection, {
      ...params,
      'where[_status][equals]': 'published',
    })
  }

  async function fetchPaginated<T>(
    collection: string,
    page: number,
    limit: number,
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<T>> {
    return fetchList<T>(collection, {
      ...params,
      page: String(page),
      limit: String(limit),
    })
  }

  async function fetchGlobal<T>(slug: string): Promise<T> {
    return fetchPayload<T>(`globals/${slug}`)
  }

  // -- Typed Collection Helpers --

  async function getAllServices(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<Service>> {
    const result = await fetchPublished<Service>('services', {
      limit: '1000',
      depth: '1',
      ...params,
    })
    if (result.hasNextPage) {
      console.warn(`[PayloadClient] getAllServices returned ${result.docs.length} of ${result.totalDocs} — results truncated`)
    }
    return result
  }

  async function getServiceBySlug(slug: string): Promise<Service | null> {
    return fetchBySlug<Service>('services', slug, 2)
  }

  async function getAllLocations(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<Location>> {
    const result = await fetchPublished<Location>('locations', {
      limit: '10000',
      depth: '1',
      ...params,
    })
    if (result.hasNextPage) {
      console.warn(`[PayloadClient] getAllLocations returned ${result.docs.length} of ${result.totalDocs} — results truncated`)
    }
    return result
  }

  async function getLocationBySlug(slug: string): Promise<Location | null> {
    return fetchBySlug<Location>('locations', slug, 2)
  }

  const MAX_SERVICE_PAGES = 500_000

  async function getAllServicePages(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<ServicePage>> {
    // Paginate in batches of 1000 to avoid OOM on large datasets (100k+ pages)
    const batchSize = 1000
    let page = 1
    let hasMore = true
    const allDocs: ServicePage[] = []
    let lastResult: PayloadListResponse<ServicePage> | null = null

    while (hasMore) {
      const result = await fetchPublished<ServicePage>('service-pages', {
        limit: String(batchSize),
        page: String(page),
        depth: '2',
        ...params,
      })
      allDocs.push(...result.docs)
      hasMore = result.hasNextPage
      lastResult = result
      page++

      if (allDocs.length >= MAX_SERVICE_PAGES) {
        console.warn(`[PayloadClient] getAllServicePages hit safety limit of ${MAX_SERVICE_PAGES} docs`)
        break
      }
    }

    return {
      docs: allDocs,
      totalDocs: lastResult?.totalDocs ?? allDocs.length,
      limit: allDocs.length,
      totalPages: 1,
      page: 1,
      pagingCounter: 1,
      hasPrevPage: false,
      hasNextPage: false,
      prevPage: null,
      nextPage: null,
    }
  }

  async function getServicePage(
    serviceSlug: string,
    locationSlug: string,
  ): Promise<ServicePage | null> {
    // Try slug-based lookup first (fast, indexed), fall back to relationship query
    const bySlug = await fetchPublished<ServicePage>('service-pages', {
      'where[slug][equals]': `${serviceSlug}-in-${locationSlug}`,
      depth: '2',
    })
    if (bySlug.docs[0]) return bySlug.docs[0]

    // Fallback: query by related service and location slugs
    const byRelation = await fetchPublished<ServicePage>('service-pages', {
      'where[and][0][service.slug][equals]': serviceSlug,
      'where[and][1][location.slug][equals]': locationSlug,
      depth: '2',
    })
    return byRelation.docs[0] ?? null
  }

  async function getAllBlogPosts(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<BlogPost>> {
    const result = await fetchPublished<BlogPost>('blog-posts', {
      limit: '1000',
      sort: '-publishedAt',
      depth: '1',
      ...params,
    })
    if (result.hasNextPage) {
      console.warn(`[PayloadClient] getAllBlogPosts returned ${result.docs.length} of ${result.totalDocs} — results truncated`)
    }
    return result
  }

  async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
    return fetchBySlug<BlogPost>('blog-posts', slug, 2)
  }

  // FAQs, Testimonials, and TeamMembers use fetchList (not fetchPublished)
  // because these collections have no versions/drafts — all saved items are public.
  async function getFAQs(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<FAQ>> {
    return fetchList<FAQ>('faqs', {
      limit: '500',
      sort: 'sortOrder',
      depth: '1',
      ...params,
    })
  }

  async function getFAQsByService(serviceId: string): Promise<PayloadListResponse<FAQ>> {
    return getFAQs({ 'where[service][equals]': serviceId })
  }

  async function getFAQsByLocation(locationId: string): Promise<PayloadListResponse<FAQ>> {
    return getFAQs({ 'where[location][equals]': locationId })
  }

  async function getTestimonials(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<Testimonial>> {
    return fetchList<Testimonial>('testimonials', {
      limit: '100',
      depth: '1',
      ...params,
    })
  }

  async function getFeaturedTestimonials(): Promise<PayloadListResponse<Testimonial>> {
    return getTestimonials({ 'where[featured][equals]': 'true' })
  }

  async function getTeamMembers(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<TeamMember>> {
    return fetchList<TeamMember>('team-members', {
      limit: '100',
      sort: 'sortOrder',
      depth: '1',
      ...params,
    })
  }

  async function getAllPages(
    params?: Record<string, string>,
  ): Promise<PayloadListResponse<Page>> {
    const result = await fetchPublished<Page>('pages', {
      limit: '1000',
      depth: '1',
      ...params,
    })
    if (result.hasNextPage) {
      console.warn(`[PayloadClient] getAllPages returned ${result.docs.length} of ${result.totalDocs} — results truncated`)
    }
    return result
  }

  async function getPageBySlug(slug: string): Promise<Page | null> {
    return fetchBySlug<Page>('pages', slug, 2)
  }

  async function getSiteSettings(): Promise<SiteSettings> {
    return fetchGlobal<SiteSettings>('site-settings')
  }

  return {
    // Generic
    fetch: fetchPayload,
    fetchList,
    fetchById,
    fetchBySlug,
    fetchPublished,
    fetchPaginated,
    fetchGlobal,
    // Typed helpers
    getAllServices,
    getServiceBySlug,
    getAllLocations,
    getLocationBySlug,
    getAllServicePages,
    getServicePage,
    getAllBlogPosts,
    getBlogPostBySlug,
    getFAQs,
    getFAQsByService,
    getFAQsByLocation,
    getTestimonials,
    getFeaturedTestimonials,
    getTeamMembers,
    getAllPages,
    getPageBySlug,
    getSiteSettings,
  }
}

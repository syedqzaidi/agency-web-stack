// ─── Composite Field Types (Twenty v1.20) ───────────────────────────────────

export interface FullName {
  firstName: string
  lastName: string
}

export interface Emails {
  primaryEmail: string
  additionalEmails?: string[]
}

export interface Phones {
  primaryPhoneNumber: string
  additionalPhones?: string[]
}

export interface Links {
  primaryLinkUrl: string
  primaryLinkLabel: string
  secondaryLinks?: Array<{ url: string; label: string }>
}

export interface Address {
  addressStreet1?: string
  addressStreet2?: string
  addressCity?: string
  addressState?: string
  addressPostcode?: string
  addressCountry?: string
  addressLat?: number | null
  addressLng?: number | null
}

export interface Currency {
  amountMicros: number | null
  currencyCode: string | null
}

export interface RichText {
  blocknote?: string
}

// ─── Core Entities ───────────────────────────────────────────────────────────

export interface Person {
  id: string
  name: FullName
  emails?: Emails
  phones?: Phones
  city?: string
  jobTitle?: string
  linkedinLink?: Links
  xLink?: Links
  avatarUrl?: string
  position?: number
  companyId?: string | null
  createdAt: string
  updatedAt: string
}

export interface Company {
  id: string
  name: string
  domainName?: Links
  address?: Address
  employees?: number
  linkedinLink?: Links
  xLink?: Links
  annualRecurringRevenue?: Currency
  idealCustomerProfile?: boolean
  position?: number
  createdAt: string
  updatedAt: string
}

export interface Opportunity {
  id: string
  name?: string
  amount?: Currency
  closeDate?: string
  stage?: string
  probability?: number
  position?: number
  pointOfContactId?: string
  companyId?: string
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  title?: string
  bodyV2?: RichText
  position?: number
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  title?: string
  bodyV2?: RichText
  status?: string // TaskStatusEnum: TODO, IN_PROGRESS, DONE
  dueAt?: string
  assigneeId?: string
  position?: number
  createdAt: string
  updatedAt: string
}

// ─── Input Types ─────────────────────────────────────────────────────────────

export type CreatePersonInput = Omit<Person, 'id' | 'createdAt' | 'updatedAt'>
export type UpdatePersonInput = Partial<CreatePersonInput>

export type CreateCompanyInput = Omit<Company, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateCompanyInput = Partial<CreateCompanyInput>

export type CreateOpportunityInput = Omit<Opportunity, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateOpportunityInput = Partial<CreateOpportunityInput>

export type CreateNoteInput = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateNoteInput = Partial<CreateNoteInput>

export type CreateTaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateTaskInput = Partial<CreateTaskInput>

// ─── GraphQL Response Shapes ─────────────────────────────────────────────────

export interface GraphQLError {
  message: string
  extensions?: Record<string, unknown>
  path?: string[]
}

export interface GraphQLResponse<T> {
  data: T
  errors?: GraphQLError[]
}

// ─── Client Config ───────────────────────────────────────────────────────────

export interface TwentyClientConfig {
  apiUrl: string
  apiKey: string
}

// ─── Filter / OrderBy / Pagination ───────────────────────────────────────────

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'like'
  | 'ilike'
  | 'is'

export interface FieldFilter {
  [operator: string]: unknown
}

export interface ObjectFilter {
  and?: ObjectFilter[]
  or?: ObjectFilter[]
  not?: ObjectFilter
  [field: string]: FieldFilter | ObjectFilter[] | ObjectFilter | undefined
}

export type OrderByDirection = 'AscNullsFirst' | 'AscNullsLast' | 'DescNullsFirst' | 'DescNullsLast'

export interface OrderByField {
  [field: string]: OrderByDirection
}

export interface PaginationInput {
  first?: number
  after?: string
  last?: number
  before?: string
}

// ─── Metadata Types ──────────────────────────────────────────────────────────

export interface CreateObjectInput {
  nameSingular: string
  namePlural: string
  labelSingular: string
  labelPlural: string
  description?: string
  icon?: string
  isRemote?: boolean
}

export interface CreateFieldInput {
  objectMetadataId: string
  name: string
  label: string
  type: string
  description?: string
  icon?: string
  isNullable?: boolean
  defaultValue?: unknown
}

export interface CreateRelationInput {
  relationType: string
  fromObjectMetadataId: string
  toObjectMetadataId: string
  fromFieldMetadataId?: string
  toFieldMetadataId?: string
  fromName: string
  toName: string
  fromLabel: string
  toLabel: string
}

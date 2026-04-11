export type {
  FullName,
  Emails,
  Phones,
  Links,
  Address,
  Currency,
  RichText,
  Person,
  Company,
  Opportunity,
  Note,
  Task,
  CreatePersonInput,
  UpdatePersonInput,
  CreateCompanyInput,
  UpdateCompanyInput,
  CreateOpportunityInput,
  UpdateOpportunityInput,
  CreateNoteInput,
  UpdateNoteInput,
  CreateTaskInput,
  UpdateTaskInput,
  GraphQLError,
  GraphQLResponse,
  TwentyClientConfig,
  FilterOperator,
  FieldFilter,
  ObjectFilter,
  OrderByDirection,
  OrderByField,
  PaginationInput,
  CreateObjectInput,
  CreateFieldInput,
  CreateRelationInput,
} from './types'

export {
  TwentyApiError,
  TwentyGraphQLError,
  TwentyNotFoundError,
  TwentyValidationError,
  TwentyAuthError,
  TwentyRateLimitError,
} from './errors'

export { TwentyClient } from './client'

import { TwentyClient } from './client'

export function createTwentyClient(): TwentyClient {
  const apiUrl = process.env.TWENTY_API_URL
  const apiKey = process.env.TWENTY_API_KEY

  if (!apiUrl) throw new Error('TWENTY_API_URL environment variable is required')
  if (!apiKey) throw new Error('TWENTY_API_KEY environment variable is required')

  return new TwentyClient({ apiUrl, apiKey })
}

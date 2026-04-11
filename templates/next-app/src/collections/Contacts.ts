import type { CollectionConfig } from 'payload'
import { isAdmin, isAdminOrEditor } from '../access'

export const Contacts: CollectionConfig = {
  slug: 'contacts',
  admin: {
    useAsTitle: 'email',
    group: 'CRM',
  },
  access: {
    read: isAdminOrEditor,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'twentyId',
      type: 'text',
      unique: true,
      index: true,
    },
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'firstName',
      type: 'text',
    },
    {
      name: 'lastName',
      type: 'text',
    },
    {
      name: 'company',
      type: 'text',
    },
    {
      name: 'engagementScore',
      type: 'number',
      defaultValue: 0,
    },
    {
      name: 'lastSyncedAt',
      type: 'date',
    },
    {
      name: 'source',
      type: 'select',
      options: [
        { label: 'Twenty Webhook', value: 'twenty-webhook' },
        { label: 'Payload Sync', value: 'payload-sync' },
        { label: 'Manual', value: 'manual' },
      ],
    },
  ],
}

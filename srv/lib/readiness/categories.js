// The kinds of things a project can depend on. The designer reads this list (readinessMeta), so a new category
// is one entry here; no designer change is needed. `order` is the order on the screen.
export const CATEGORIES = [
  {
    id: 'destinations',
    label: 'Destinations',
    icon: 'sap-icon://chain-link',
    description:
      'Named connections to other systems: they must exist in BTP and point to the right system.',
  },
  {
    id: 'apis',
    label: 'Services & APIs',
    icon: 'sap-icon://connected',
    description: 'S/4HANA, custom and other OData services (V2 / V4) the app calls or serves.',
  },
  {
    id: 'auth',
    label: 'Authorization',
    icon: 'sap-icon://locked',
    description: 'Scopes, roles and role collections, and where the code asks for them.',
  },
  {
    id: 'workzone',
    label: 'Work Zone',
    icon: 'sap-icon://home',
    description: 'Launchpad content: apps, tiles, navigation intents and the roles that show them.',
  },
  {
    id: 'bpa',
    label: 'Process automation',
    icon: 'sap-icon://process',
    description:
      'SAP Build Process Automation / Workflow: services, process definitions and the calls that start them.',
  },
  {
    id: 'btp',
    label: 'BTP services',
    icon: 'sap-icon://cloud',
    description:
      'Service instances and subscriptions the deployment needs (XSUAA, destination, HANA ...).',
  },
  {
    id: 'config',
    label: 'Configuration',
    icon: 'sap-icon://action-settings',
    description: 'Environment variables and profiles the app reads at start-up.',
  },
  {
    id: 'other',
    label: 'Other checks',
    icon: 'sap-icon://checklist-item',
    description: 'Things only a person can know, added by hand.',
  },
].map((c, order) => ({ ...c, order }))

export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id))

/** How a person answers a check. `open` is the starting point. */
export const STATUSES = [
  { id: 'open', label: 'Not checked', state: 'None', icon: 'sap-icon://pending' },
  { id: 'working', label: 'Working', state: 'Success', icon: 'sap-icon://sys-enter-2' },
  { id: 'broken', label: 'Not working', state: 'Error', icon: 'sap-icon://error' },
  { id: 'na', label: 'Not needed', state: 'None', icon: 'sap-icon://sys-minus' },
]

export const STATUS_IDS = new Set(STATUSES.map((s) => s.id))

/** What a scan finding can say; the first is the most serious. */
export const LEVELS = ['error', 'warning', 'info', 'ok']

export const SEVERITIES = ['high', 'normal', 'low']

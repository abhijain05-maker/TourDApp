// What the BTP services in an mta.yaml are for and how a person checks that one exists. Add a line to cover another
// service; a service that is not listed is still found, with the general checks.
//   category: where the item appears (default 'btp')
export const BTP_SERVICES = {
  xsuaa: {
    label: 'Authorization and Trust Management (XSUAA)',
    verify: [
      'The instance was created from xs-security.json. After a change to the file, update the instance (cf update-service or redeploy) or the new scopes do not exist.',
    ],
  },
  destination: {
    label: 'Destination service',
    verify: [
      'The destinations the app uses exist in this instance or in the subaccount (Connectivity > Destinations).',
    ],
  },
  connectivity: {
    label: 'Connectivity service (Cloud Connector)',
    verify: [
      'Needed for on-premise systems. In the Cloud Connector the subaccount is connected and the virtual host / resources of the destination are exposed.',
    ],
  },
  hana: {
    label: 'SAP HANA (HDI container)',
    verify: ['The HDI container exists and the db deployer finished without errors.'],
  },
  'hana-cloud': {
    label: 'SAP HANA Cloud',
    verify: ['The HANA Cloud instance is running and mapped to this space.'],
  },
  'html5-apps-repo': {
    category: 'workzone',
    label: 'HTML5 Application Repository',
    verify: [
      'The UI apps are deployed to the repository (plan app-host) and the approuter can read them (plan app-runtime).',
    ],
  },
  portal: {
    category: 'workzone',
    label: 'Portal / Work Zone service',
    verify: ['The subscription to the launchpad service exists in this subaccount.'],
  },
  'SAP-PORTAL-SERVICE': {
    category: 'workzone',
    label: 'Work Zone (portal service)',
    verify: ['The subscription to SAP Build Work Zone exists in this subaccount.'],
  },
  'build-workzone-standard': {
    category: 'workzone',
    label: 'SAP Build Work Zone, standard edition',
    verify: ['The subscription exists and a site is created.'],
  },
  'process-automation': {
    category: 'bpa',
    label: 'SAP Build Process Automation',
    verify: [
      'The subscription or instance exists. Processes are deployed in the Lobby > Control Tower > Environments.',
    ],
  },
  'process-automation-service': {
    category: 'bpa',
    label: 'SAP Build Process Automation (API access)',
    verify: [
      'An instance with a service key exists; its client id and secret are used by the destination that starts processes.',
    ],
  },
  workflow: {
    category: 'bpa',
    label: 'SAP Workflow service',
    verify: ['The instance exists and the workflow definition is deployed.'],
  },
  'application-logs': { label: 'Application Logging', verify: [] },
  'cloud-logging': { label: 'Cloud Logging', verify: [] },
  'saas-registry': {
    label: 'SaaS Provisioning (saas-registry)',
    verify: ['The application is registered and subscriptions work.'],
  },
  credstore: {
    label: 'Credential Store',
    verify: ['The namespace and the credentials the app reads exist.'],
  },
  identity: {
    label: 'Identity Authentication (IAS)',
    verify: ['The application is registered in the IAS tenant and trusted in this subaccount.'],
  },
  'postgresql-db': { label: 'PostgreSQL', verify: ['The instance is running and reachable.'] },
}

export const infoFor = (service) => BTP_SERVICES[service] ?? { label: service, verify: [] }

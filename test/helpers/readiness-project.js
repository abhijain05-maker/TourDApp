// A small CAP project that has most of the things the readiness scan looks for, including a few mistakes on purpose.
const j = (o) => JSON.stringify(o, null, 2)

const edmx = (version, sets) =>
  `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="${version}" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices>
    <Schema Namespace="X">
      <EntityContainer Name="C">
${sets.map((s) => `        <EntitySet Name="${s}" EntityType="X.${s}"/>`).join('\n')}
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
`

export const readinessProject = () => [
  {
    path: 'package.json',
    content: j({
      name: 'leave-app',
      cds: {
        requires: {
          auth: { kind: 'xsuaa' },
          API_BUSINESS_PARTNER: {
            kind: 'odata-v2',
            model: 'srv/external/API_BUSINESS_PARTNER',
            credentials: { destination: 'S4_DEV', path: '/sap/opu/odata/sap/API_BUSINESS_PARTNER' },
          },
          ZLEAVE_SRV: {
            kind: 'odata-v4',
            model: 'srv/external/ZLEAVE_SRV',
            credentials: { destination: 'S4_DEV', path: '/sap/opu/odata/sap/ZLEAVE_SRV' },
          },
          PRICES: { kind: 'odata-v2', credentials: { url: 'https://prices.example.com/odata' } },
        },
        '[production]': { requires: { db: { kind: 'hana' }, auth: { kind: 'xsuaa' } } },
        '[hybrid]': { requires: { db: { kind: 'sqlite' } } },
      },
    }),
  },
  {
    path: 'mta.yaml',
    content: `_schema-version: '3.1'
ID: leave-app
version: 1.0.0
modules:
  - name: leave-srv
    type: nodejs
    path: gen/srv
    properties:
      BPA_PROCESS_ID: eu10.acme.leave
    requires:
      - name: leave-auth
  - name: leave-router
    type: approuter.nodejs
    path: app/router
    properties:
      destinations: '[{"name":"srv-api","url":"~{srv-url}","forwardAuthToken":true}]'
resources:
  - name: leave-auth
    type: org.cloudfoundry.managed-service
    parameters:
      service: xsuaa
      service-plan: application
      path: ./xs-security.json
  - name: leave-destination
    type: org.cloudfoundry.managed-service
    parameters:
      service: destination
      service-plan: lite
      config:
        init_data:
          instance:
            destinations:
              - Name: S4_DEV
                URL: https://s4dev.example.com
                Authentication: BasicAuthentication
                ProxyType: Internet
                User: TECH
                Password: letmein
              - Name: BPA_RUNTIME
                URL: http://localhost:8080
                Authentication: NoAuthentication
  - name: leave-html5
    type: org.cloudfoundry.managed-service
    parameters:
      service: html5-apps-repo
      service-plan: app-host
  - name: leave-bpa
    type: org.cloudfoundry.existing-service
    parameters:
      service: process-automation-service
      service-name: bpa-api
`,
  },
  {
    path: 'xs-security.json',
    content: j({
      xsappname: 'leave-app',
      'tenant-mode': 'dedicated',
      scopes: [
        { name: '$XSAPPNAME.Admin', description: 'Administrate' },
        { name: '$XSAPPNAME.Viewer', description: 'Read' },
        { name: '$XSAPPNAME.Unused', description: 'Nobody asks for it' },
      ],
      'role-templates': [
        { name: 'Admin', 'scope-references': ['$XSAPPNAME.Admin', '$XSAPPNAME.Viewer'] },
        { name: 'Viewer', 'scope-references': ['$XSAPPNAME.Viewer'] },
      ],
      'role-collections': [
        {
          name: 'Leave Admin',
          description: 'Admins',
          'role-template-references': ['$XSAPPNAME.Admin'],
        },
      ],
      'oauth2-configuration': {
        'redirect-uris': [
          'http://localhost:5000/login/callback',
          'https://*.cfapps.eu10.hana.ondemand.com/**',
        ],
      },
    }),
  },
  {
    path: 'srv/service.cds',
    content: `using { leave } from '../db/schema';
@path: '/odata/v4/main'
@requires: 'Admin'
service MainService {
  @restrict: [{ grant: 'READ', to: ['Viewer', 'Auditor'] }, { grant: '*', to: 'authenticated-user' }]
  entity Requests as projection on leave.Requests;
}
`,
  },
  {
    path: 'srv/external/API_BUSINESS_PARTNER.edmx',
    content: edmx('1.0', ['A_BusinessPartner', 'A_Customer']),
  },
  { path: 'srv/external/ZLEAVE_SRV.edmx', content: edmx('1.0', ['Leave']) },
  {
    path: 'srv/handler.js',
    content: `const cds = require('@sap/cds')
module.exports = async () => {
  const bp = await cds.connect.to('API_BUSINESS_PARTNER')
  const lost = await cds.connect.to('MISSING_SVC')
  const id = process.env.BPA_PROCESS_ID
  const mode = process.env.MODE || 'basic'
  const secret = process.env.LEAVE_API_KEY
  const body = { definitionId: 'eu10.acme.leave.process', context: {} }
  await executeHttpRequest({ destinationName: 'BPA_RUNTIME' }, { url: '/workflow/rest/v1/workflow-instances', method: 'POST', data: body })
  await fetch('/sap/opu/odata/sap/API_PRODUCT_SRV/A_Product')
  if (req.user.is('Admin')) return bp
}
`,
  },
  {
    path: 'app/router/xs-app.json',
    content: j({
      authenticationMethod: 'route',
      routes: [
        {
          source: '^/odata/v4/main/(.*)$',
          destination: 'srv-api',
          authenticationType: 'xsuaa',
          scope: '$XSAPPNAME.Viewer',
        },
        { source: '^/sap/opu/(.*)$', destination: 'S4_DEV', authenticationType: 'none' },
      ],
    }),
  },
  {
    path: 'app/leave/webapp/manifest.json',
    content: j({
      'sap.app': {
        id: 'acme.leave',
        title: 'Leave requests',
        dataSources: {
          mainService: { uri: '/odata/v4/main/', type: 'OData', settings: { odataVersion: '4.0' } },
          lostService: {
            uri: '/odata/v2/other/',
            type: 'OData',
            settings: { odataVersion: '2.0' },
          },
        },
        crossNavigation: {
          inbounds: {
            leave: {
              semanticObject: 'Leave',
              action: 'manage',
              title: '{{appTitle}}',
              signature: { parameters: {} },
            },
          },
          outbounds: { toBp: { semanticObject: 'BusinessPartner', action: 'display' } },
        },
      },
    }),
  },
  { path: 'app/leave/webapp/Component.js', content: '// no calls here\n' },
  { path: 'README.md', content: '# leave app\n' },
]

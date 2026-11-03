// SAP Build Process Automation / Workflow: the processes the code starts, and the API it calls to start them.
// The service instance itself comes from mta.yaml (btp.js). Whether a process is deployed in this tenant can only be
// seen in the tenant, so each process gets its steps.
import { isCode, matches } from '../util.js'

const PROCESS_VERIFY = (id) => [
  `SAP Build Process Automation > Lobby: the project with the process is released and deployed to the environment of this landscape (a deployment to development does not reach test or production).`,
  `Control Tower > Environments (or Monitor): the deployed version is Active and the definition ID is "${id}". The ID in the code must be the one of the deployed process.`,
  'Start one instance (from the code, or Monitor > Processes and Workflows) and check that it is created and reaches its first step.',
  'The people who must act have the process participant role and see the task in My Inbox.',
]

export default {
  id: 'bpa',
  phase: 'extract',
  run(ctx) {
    let api
    for (const file of ctx.find(isCode)) {
      if (/(^|\/)webapp\//.test(file.path)) continue
      for (const { m, line } of matches(
        file.content,
        /\bdefinitionId\s*[:=]\s*['"`]([\w.\-]+)['"`]/g,
      )) {
        ctx.add({
          category: 'bpa',
          kind: 'process',
          name: m[1],
          title: m[1],
          summary: 'Process definition ID used in code',
          severity: 'high',
          source: { path: file.path, line },
          fields: [
            {
              id: 'version',
              label: 'Deployed version',
              hint: 'Version of the process active in this landscape',
            },
          ],
          verify: PROCESS_VERIFY(m[1]),
        })
      }
      for (const { line } of matches(
        file.content,
        /\/workflow\/rest\/v1\/workflow-instances|\/public\/workflow\/rest\/v1|\/spa-process-automation\b|bpmworkflowruntime/g,
      )) {
        api = ctx.add({
          category: 'bpa',
          kind: 'api',
          name: 'workflow-api',
          title: 'Workflow / process API',
          summary: 'The code starts or reads processes through the workflow API',
          severity: 'high',
          source: { path: file.path, line },
          fields: [
            {
              id: 'destination',
              label: 'Destination / service key',
              hint: 'Name of the destination that holds the service key of the process automation instance',
            },
          ],
          verify: [
            'A destination (or the service binding) with the client id, secret and token URL of the process automation service key exists in this landscape.',
            'The client has the scope to start instances (for example WORKFLOW_INSTANCE_START); the XSUAA role of the service key contains it.',
            'Call the API once with that client: POST a test instance and expect 201.',
          ],
        })
      }
    }
    if (api) for (const p of ctx.items('bpa', 'process')) ctx.relate(api, p.key, 'uses')
    for (const file of ctx.find((p) => /\.(bpmn|bpmn20\.xml)$/.test(p))) {
      ctx.add({
        category: 'bpa',
        kind: 'process-file',
        name: file.path,
        title: file.path.split('/').pop(),
        summary: 'Process model in the project',
        severity: 'normal',
        source: { path: file.path },
        verify: PROCESS_VERIFY('(see the model)'),
      })
    }
  },
}

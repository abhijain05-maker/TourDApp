// BTP service instances the deployment needs: the resources of mta.yaml.
import { asArray, dirname, isObject, lineOf } from '../util.js'
import { infoFor } from '../knowledge/btp-services.js'
import { mtaDocs, mtaExtensions, resolvePath } from './parsed.js'

const MANAGED = 'org.cloudfoundry.managed-service'
const EXISTING = 'org.cloudfoundry.existing-service'
const USER_PROVIDED = 'org.cloudfoundry.user-provided-service'

export default {
  id: 'btp',
  phase: 'extract',
  run(ctx) {
    for (const { file, doc } of mtaDocs(ctx)) {
      for (const r of asArray(doc.resources)) {
        if (!isObject(r) || !r.name) continue
        const params = isObject(r.parameters) ? r.parameters : {}
        if (![MANAGED, EXISTING, USER_PROVIDED].includes(r.type) && !params.service) continue
        const service =
          params.service ??
          (r.type === USER_PROVIDED
            ? 'user-provided'
            : r.type === EXISTING
              ? 'existing'
              : 'service')
        const info = infoFor(service)
        const plan = params['service-plan']
        const existing = r.type === EXISTING
        const line = lineOf(
          file.content,
          new RegExp(`name:\\s*['"]?${escapeRe(r.name)}['"]?\\s*$`, 'm'),
        )
        const key = ctx.add({
          category: info.category ?? 'btp',
          kind: 'service-instance',
          name: r.name,
          title: r.name,
          summary: [info.label, plan && `plan ${plan}`, existing && 'must exist before the deploy']
            .filter(Boolean)
            .join(' · '),
          severity: [
            'xsuaa',
            'destination',
            'hana',
            'hana-cloud',
            'connectivity',
            'process-automation-service',
            'workflow',
          ].includes(service)
            ? 'high'
            : 'normal',
          source: { path: file.path, line },
          attrs: { service, plan, serviceName: params['service-name'], resourceType: r.type },
          verify: [
            `BTP cockpit > Services > Instances and Subscriptions (or "cf services"): ${existing ? `"${params['service-name'] ?? r.name}"` : `"${r.name}"`} exists in the target space and is not in a failed state.`,
            ...info.verify,
          ],
        })
        if (existing)
          ctx.signal(
            key,
            'warning',
            'existing-service',
            `The deployment does not create this instance (existing-service "${params['service-name'] ?? r.name}"). It must be created by hand in every space you deploy to.`,
          )
        if (service === 'xsuaa' && params.path) {
          const target = resolvePath(dirname(file.path), params.path)
          if (!ctx.file(target))
            ctx.signal(
              key,
              'error',
              'missing-file',
              `mta.yaml points to ${params.path} for the instance configuration, but ${target} is not in the project.`,
            )
        }
      }
    }
    // values that differ per environment live in extension descriptors; the checklist says where to look
    for (const { file, doc } of mtaExtensions(ctx)) {
      for (const r of asArray(doc.resources)) {
        const item = ctx.items().find((i) => i.kind === 'service-instance' && i.name === r?.name)
        if (!item) continue
        ctx.add({
          category: item.category,
          kind: item.kind,
          name: item.name,
          source: { path: file.path },
        })
        ctx.signal(
          item.key,
          'info',
          'per-environment',
          `${file.path} changes this resource for one environment. Check the values for the system you deploy to.`,
        )
      }
    }
  },
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

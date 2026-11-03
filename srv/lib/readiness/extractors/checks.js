// Checks across everything the extractors found. They only add findings (signals) to items; they run last.
import { mtaDocs } from './parsed.js'

export default {
  id: 'checks',
  phase: 'check',
  run(ctx) {
    const hasMta = mtaDocs(ctx).length > 0
    const instances = ctx.items(undefined, 'service-instance')
    const has = (service) => instances.some((i) => i.attrs.service === service)

    // a destination that only the code or a route names: it lives in BTP
    for (const d of ctx.items('destinations', 'destination')) {
      if (d.attrs.definedIn !== 'project')
        ctx.signal(
          d.key,
          'info',
          'defined-elsewhere',
          'Not defined in the project files, so it has to exist in BTP. Nothing in the project can say where it points to.',
        )
      if (hasMta && !has('destination'))
        ctx.signal(
          d.key,
          'warning',
          'no-destination-service',
          'mta.yaml has no destination service instance, so the deployed app cannot read destinations.',
        )
    }

    // roles: asked for but not defined, defined but not connected
    if (ctx.shared.hasXsSecurity) {
      const usedAnywhere = ctx.items('auth', 'scope').some((s) => s.attrs.usedInProject)
      for (const s of ctx.items('auth', 'scope')) {
        if (s.attrs.usedInProject && !s.attrs.scope)
          ctx.signal(
            s.key,
            'error',
            'undefined-scope',
            `The project asks for the role "${s.name}" (${s.sources[0]?.path}), but xs-security.json defines no scope with that name. Add it, then update the XSUAA instance.`,
          )
        else if (usedAnywhere && s.attrs.scope && !s.attrs.usedInProject && !s.attrs.grantedApps)
          ctx.signal(
            s.key,
            'info',
            'unused-scope',
            'Nothing in the project asks for this scope (@requires, @restrict, user.is, route scope).',
          )
      }
      for (const t of ctx.items('auth', 'role-template'))
        for (const l of t.links.filter((x) => x.rel === 'uses'))
          if (!ctx.get(l.key))
            ctx.signal(
              t.key,
              'error',
              'missing-scope',
              'References a scope that xs-security.json does not define.',
            )
      if (hasMta && !has('xsuaa')) {
        const app = ctx.items('auth', 'application')[0]
        if (app)
          ctx.signal(
            app.key,
            'warning',
            'no-xsuaa-service',
            'xs-security.json exists, but mta.yaml creates no XSUAA instance from it.',
          )
      }
    } else if (ctx.items('auth', 'scope').length) {
      for (const s of ctx.items('auth', 'scope'))
        ctx.signal(
          s.key,
          'warning',
          'no-xs-security',
          'The project asks for this role, but has no xs-security.json. Define the role where the XSUAA instance is created.',
        )
    }
    for (const l of ctx.items('auth', 'login'))
      if (hasMta && l.attrs.strategy === 'xsuaa' && !has('xsuaa'))
        ctx.signal(
          l.key,
          'warning',
          'no-xsuaa-service',
          'Login uses XSUAA, but mta.yaml has no XSUAA instance.',
        )

    // two apps with the same navigation intent: the launchpad opens one of them
    const seen = new Map()
    for (const i of ctx.items('workzone', 'inbound')) {
      const intent = `${i.attrs.semanticObject}-${i.attrs.action}`
      if (seen.has(intent) && seen.get(intent).attrs.app !== i.attrs.app) {
        for (const x of [i, seen.get(intent)])
          ctx.signal(
            x.key,
            'warning',
            'duplicate-intent',
            `Another app also answers #${intent}. The launchpad picks one of them.`,
          )
      } else seen.set(intent, i)
    }
  },
}

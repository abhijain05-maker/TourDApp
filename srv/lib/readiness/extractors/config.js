// Configuration: environment variables the code reads, and the database each profile uses.
import { asArray, isObject, isServerCode, lineOf, matches } from '../util.js'
import { cdsConfigs, mtaDocs } from './parsed.js'

const IGNORED =
  /^(NODE_|npm_|CDS_|PORT$|HOME$|PATH$|PWD$|USER$|USERNAME$|CI$|TZ$|LANG$|DEBUG$|VCAP_|CF_|TEMP$|TMP$)/

export default {
  id: 'config',
  phase: 'extract',
  run(ctx) {
    // variables set in mta.yaml
    const set = new Map() // name -> {path, line}
    for (const { file, doc } of mtaDocs(ctx)) {
      for (const m of asArray(doc.modules)) {
        const env = {
          ...(isObject(m?.properties) ? m.properties : {}),
          ...(isObject(m?.parameters?.env) ? m.parameters.env : {}),
        }
        for (const name of Object.keys(env))
          set.set(name, { path: file.path, line: lineOf(file.content, name) })
      }
    }
    const hasMta = mtaDocs(ctx).length > 0

    for (const file of ctx.find(isServerCode)) {
      for (const { m, line } of matches(
        file.content,
        /process\.env(?:\.([A-Za-z_][\w]*)|\[\s*['"`]([\w]+)['"`]\s*\])/g,
      )) {
        const name = m[1] ?? m[2]
        if (IGNORED.test(name)) continue
        const after = file.content.slice(m.index + m[0].length, m.index + m[0].length + 12)
        const hasDefault = /^\s*(\|\||\?\?)/.test(after)
        const key = ctx.add({
          category: 'config',
          kind: 'env',
          name,
          title: name,
          summary: hasDefault
            ? 'Environment variable with a default value'
            : 'Environment variable the code reads',
          severity: hasDefault ? 'low' : 'normal',
          source: { path: file.path, line },
          attrs: { setIn: set.get(name)?.path, hasDefault: hasDefault || undefined },
          verify: [
            'It is set where the app runs: mta.yaml module properties, "cf set-env", or a user-provided service. For local runs: a .env file that is not committed.',
          ],
          fields: [
            {
              id: 'value',
              label: 'Value in this landscape',
              hint: 'Never write a secret here; say where it is kept',
            },
          ],
        })
        if (set.has(name)) ctx.add({ category: 'config', kind: 'env', name, source: set.get(name) })
        else if (hasMta && !hasDefault)
          ctx.signal(
            key,
            'info',
            'not-in-mta',
            'No module in mta.yaml sets this variable. It has to be set another way, or the app starts without it.',
          )
      }
    }

    for (const { file, profile, config } of cdsConfigs(ctx)) {
      const db = config.requires?.db
      const kind = typeof db === 'string' ? db : db?.kind
      if (!kind) continue
      const key = ctx.add({
        category: 'config',
        kind: 'database',
        name: profile || 'default',
        title: `Database (${profile || 'default'} profile)`,
        summary: `Kind ${kind}`,
        severity: 'normal',
        source: { path: file.path, line: lineOf(file.content, '"db"') },
        attrs: { kind, profile: profile || 'default' },
        verify:
          kind === 'hana'
            ? ['The HDI container exists and the database deployment finished without errors.']
            : [],
      })
      if (profile === 'production' && /sqlite|^sql$/.test(kind))
        ctx.signal(
          key,
          'error',
          'sqlite-in-production',
          `The production profile uses ${kind}. Data would be lost at every restart.`,
        )
    }
  },
}

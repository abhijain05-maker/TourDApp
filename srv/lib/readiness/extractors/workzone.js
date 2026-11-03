// SAP Build Work Zone / Launchpad: the apps and navigation intents the UI apps declare in manifest.json.
// What cannot be read from the project (the site, the content provider, the roles in Work Zone) becomes one
// checklist item with the steps, because those are the things that are "not showing up" after a deploy.
import { isObject, lineOf } from '../util.js'
import { appManifests } from './parsed.js'

export default {
  id: 'workzone',
  phase: 'extract',
  run(ctx) {
    for (const { file, doc } of appManifests(ctx)) {
      const app = doc['sap.app']
      const inbounds = isObject(app.crossNavigation?.inbounds) ? app.crossNavigation.inbounds : {}
      const outbounds = isObject(app.crossNavigation?.outbounds)
        ? app.crossNavigation.outbounds
        : {}
      const cloudService = doc['sap.cloud']?.service
      const hasIntents = Object.keys(inbounds).length > 0
      if (!hasIntents && !cloudService) continue

      const appKey = ctx.add({
        category: 'workzone',
        kind: 'app',
        name: app.id,
        title: app.id,
        summary: [
          'UI app',
          app.title && !String(app.title).startsWith('{{') ? app.title : undefined,
          cloudService && `cloud service ${cloudService}`,
        ]
          .filter(Boolean)
          .join(' · '),
        severity: 'normal',
        source: { path: file.path, line: lineOf(file.content, '"id"') },
        attrs: { cloudService, intents: Object.keys(inbounds).length || undefined },
        verify: [
          'The app is deployed (HTML5 Application Repository) and opens from the approuter URL without the launchpad.',
        ],
      })
      if (hasIntents && !cloudService)
        ctx.signal(
          appKey,
          'warning',
          'no-cloud-service',
          'manifest.json has navigation intents but no "sap.cloud": { "service": ... }. On BTP the app cannot be added to a Work Zone site without it.',
        )

      for (const [id, inb] of Object.entries(inbounds)) {
        if (!isObject(inb) || !inb.semanticObject || !inb.action) continue
        const intent = `${inb.semanticObject}-${inb.action}`
        const key = ctx.add({
          category: 'workzone',
          kind: 'inbound',
          name: `${intent} (${app.id})`,
          title: `#${intent}`,
          summary: `Navigation intent of ${app.id}${inb.title && !String(inb.title).startsWith('{{') ? ` · ${inb.title}` : ''}`,
          severity: 'high',
          source: { path: file.path, line: lineOf(file.content, `"${id}"`) },
          attrs: { semanticObject: inb.semanticObject, action: inb.action, app: app.id },
          fields: [
            {
              id: 'workzoneRole',
              label: 'Work Zone role / group',
              hint: 'The role and group that contain this app in the site',
            },
          ],
          verify: [
            `Work Zone > Content Manager > Content Explorer: the app ${app.id} is listed (Channel Manager: update the HTML5 Apps content provider if it is not).`,
            `The app is added to My Content, its tile or intent #${intent} is in a Group, and a Role contains the group.`,
            'The role is assigned to the site, and the user has the matching BTP role collection (Work Zone roles are separate from the roles of the app itself).',
            `Open the site and start the app by its tile; then open ...#${intent} directly.`,
          ],
        })
        ctx.relate(key, appKey, 'uses')
      }
      for (const [id, out] of Object.entries(outbounds)) {
        if (!isObject(out) || !out.semanticObject || !out.action) continue
        const intent = `${out.semanticObject}-${out.action}`
        const key = ctx.add({
          category: 'workzone',
          kind: 'outbound',
          name: `${intent} from ${app.id}`,
          title: `→ #${intent}`,
          summary: `${app.id} navigates to another app`,
          severity: 'normal',
          source: { path: file.path, line: lineOf(file.content, `"${id}"`) },
          attrs: { semanticObject: out.semanticObject, action: out.action, app: app.id },
          verify: [
            `An app with the inbound #${intent} is in the same site and the user's role contains it; otherwise the navigation shows "navigation target not found".`,
          ],
        })
        ctx.relate(appKey, key, 'uses')
      }
    }

    // the part that lives in Work Zone itself
    const mine = ctx.items('workzone')
    if (mine.length) {
      const site = ctx.add({
        category: 'workzone',
        kind: 'site',
        name: 'work-zone-site',
        title: 'Work Zone site and content',
        summary: 'Site, content provider, groups and roles in SAP Build Work Zone',
        severity: 'high',
        fields: [{ id: 'site', label: 'Site URL', hint: 'Address of the site for this landscape' }],
        verify: [
          'The Work Zone subscription exists in this subaccount and a site is created.',
          'Channel Manager has a content provider "HTML5 Apps" (and one for the S/4HANA system if its apps are used); it was updated after the last deploy.',
          'The roles and groups with the apps are assigned to the site, and the users have the role collections that grant them.',
        ],
      })
      for (const i of mine.filter((x) => x.kind === 'app')) ctx.relate(site, i.key, 'uses')
    }
  },
}

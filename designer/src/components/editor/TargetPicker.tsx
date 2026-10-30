import { useMemo, useState } from 'react'
import { Bar, Button, Dialog, Input, List, ListItemStandard, Text, Title } from '@ui5/webcomponents-react'
import type { Inventory, InventoryControl } from '../../types'
import { Tag } from '../common'

const short = (viewName?: string | null) => (viewName ?? '').split('.').slice(-1)[0]
const typeName = (type: string) => type.split('.').slice(-1)[0]
// controls drawn at once; every row is a web component, so thousands would make typing sluggish
const MAX_SHOWN = 150

/** Lists every control of the app (grouped by page) so a step can be pointed at one without typing ids. */
export default function TargetPicker(props: {
  open: boolean
  inventory: Inventory | undefined
  onClose: () => void
  onPick: (control: InventoryControl) => void
}) {
  const { inventory } = props
  const [query, setQuery] = useState('')

  const { groups, matches } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map<string, { control: InventoryControl; index: number }[]>()
    let matches = 0
    ;(inventory?.controls ?? []).forEach((control, index) => {
      const hay = [control.display, control.localId, control.type, control.viewName].filter(Boolean).join(' ').toLowerCase()
      if (q && !hay.includes(q)) return
      matches++
      if (matches > MAX_SHOWN) return // a big app has thousands of controls: draw the first ones, the search narrows it down
      const key = control.viewName ?? '(global)'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push({ control, index })
    })
    return { groups: [...map.entries()], matches }
  }, [inventory, query])

  return (
    <Dialog
      open={props.open}
      headerText="Choose the control this step points at"
      onClose={props.onClose}
      data-testid="target-picker"
      footer={<Bar endContent={<Button design="Transparent" onClick={props.onClose}>Cancel</Button>} />}
    >
      <div className="stack" style={{ width: 'min(40rem, 85vw)' }}>
        <Input
          placeholder="Search by text, id or type"
          value={query}
          onInput={(e) => setQuery(e.target.value)}
          style={{ width: '100%' }}
          data-testid="target-search"
        />
        {!inventory && <Text className="muted">The app's files are not loaded yet.</Text>}
        {inventory && groups.length === 0 && <Text className="muted">No control matches.</Text>}
        {matches > MAX_SHOWN && (
          <Text className="muted" data-testid="target-truncated">
            Showing the first {MAX_SHOWN} of {matches} controls. Type to narrow the list down.
          </Text>
        )}
        <div style={{ maxHeight: '55vh', overflow: 'auto' }}>
          {groups.map(([view, items]) => (
            <div key={view}>
              <Title level="H6" style={{ margin: '0.75rem 0 0.25rem' }}>
                {short(view)} <span className="muted mono">{view}</span>
              </Title>
              <List
                onItemClick={(e) => {
                  const index = Number((e.detail.item as HTMLElement).dataset.index)
                  props.onPick(inventory!.controls[index])
                }}
              >
                {items.map(({ control, index }) => (
                  <ListItemStandard
                    key={index}
                    data-index={index}
                    data-testid="target-option"
                    description={`${typeName(control.type)} · ${control.localId ?? 'no id'}${control.scope === 'fragment' ? ' · dialog' : ''}`}
                    additionalText={!control.hasStableId ? 'unstable' : undefined}
                    additionalTextState={!control.hasStableId ? 'Critical' : 'None'}
                  >
                    {control.display ?? control.localId ?? typeName(control.type)}
                  </ListItemStandard>
                ))}
              </List>
            </div>
          ))}
        </div>
        <Tag colorScheme="8">Controls without a stable id can only be found by their text.</Tag>
      </div>
    </Dialog>
  )
}

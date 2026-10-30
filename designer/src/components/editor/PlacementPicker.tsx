import { Button, CheckBox, Text } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/comment.js'
import { CardHead } from '../common'
import '@ui5/webcomponents-icons/dist/navigation-up-arrow.js'
import '@ui5/webcomponents-icons/dist/navigation-down-arrow.js'
import '@ui5/webcomponents-icons/dist/navigation-left-arrow.js'
import '@ui5/webcomponents-icons/dist/navigation-right-arrow.js'
import { buildPlacement, parsePlacement, type Side } from '../../editor/model'

const ARROWS: Record<Side, { icon: string; label: string }> = {
  Top: { icon: 'navigation-up-arrow', label: 'Above the control' },
  Left: { icon: 'navigation-left-arrow', label: 'Left of the control' },
  Right: { icon: 'navigation-right-arrow', label: 'Right of the control' },
  Bottom: { icon: 'navigation-down-arrow', label: 'Below the control' },
}

/** Where the bubble sits relative to the highlighted control: pick a side, optionally allow it to flip. */
export default function PlacementPicker({ value, onChange }: { value: string; onChange: (placement: string) => void }) {
  const { side, flip } = parsePlacement(value)
  return (
    <div className="form-sec stack" data-testid="placement-picker">
      <CardHead compact icon="comment" title="Bubble position" />
      <div className="row" style={{ gap: '1.25rem', alignItems: 'center' }}>
        <div className="compass" role="group" aria-label="Bubble position">
          {(['Top', 'Left', 'Right', 'Bottom'] as Side[]).map((s) => (
            <Button
              key={s}
              className={`compass-${s}`}
              icon={ARROWS[s].icon}
              tooltip={ARROWS[s].label}
              design={s === side ? 'Emphasized' : 'Default'}
              aria-pressed={s === side}
              data-testid={`placement-${s}`}
              onClick={() => onChange(buildPlacement(s, flip || side === null))}
            />
          ))}
          <span className="compass-center" aria-hidden="true">
            control
          </span>
        </div>
        <div className="stack" style={{ gap: '0.25rem', flex: '1 1 12rem', minWidth: 0 }}>
          <CheckBox
            text="Use the other side if there is no room"
            checked={flip}
            disabled={side === null}
            data-testid="placement-flip"
            onChange={(e) => side && onChange(buildPlacement(side, e.target.checked ?? false))}
          />
          <Text className="muted" data-testid="placement-value">
            {value}
            {side === null ? ' (chosen automatically; pick a side to fix it)' : ''}
          </Text>
        </div>
      </div>
    </div>
  )
}

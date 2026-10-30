import '@ui5/webcomponents-icons/dist/navigation-up-arrow.js'
import '@ui5/webcomponents-icons/dist/navigation-down-arrow.js'
import { useId, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { Bar, Button, Dialog, Icon, MessageStrip, Tag as UI5Tag, Text, Title } from '@ui5/webcomponents-react'

/**
 * A card that opens and closes. Closed, its header shows a one-line summary; the content stays in the page (hidden), so
 * what the person typed is kept. Closed by default: most people only need the summary.
 */
export function CollapsibleCard(props: {
  icon: string
  title: string
  /** shown under the title while the card is open */
  subtitle?: ReactNode
  /** shown under the title while the card is closed */
  summary?: ReactNode
  defaultOpen?: boolean
  testid?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const [open, setOpen] = useState(!!props.defaultOpen)
  const bodyId = useId()
  return (
    <section className={`card collapsible${open ? ' open' : ''}`} style={props.style} aria-label={props.title} data-testid={props.testid}>
      <button type="button" className="card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} data-testid="card-toggle">
        <CardHead icon={props.icon} title={props.title} subtitle={open ? props.subtitle : (props.summary ?? props.subtitle)} />
        <span className="card-toggle-hint">{open ? 'Hide' : 'Show'}</span>
        <Icon name={open ? 'navigation-up-arrow' : 'navigation-down-arrow'} className="card-toggle-chevron" />
      </button>
      <div id={bodyId} className="card-body stack" hidden={!open}>
        {props.children}
      </div>
    </section>
  )
}

/** The heading of a card: an icon badge, the title and one line saying what the card is for. */
export function CardHead({ icon, title, subtitle, compact }: { icon: string; title: string; subtitle?: ReactNode; compact?: boolean }) {
  return (
    <div className={`card-head${compact ? ' compact' : ''}`}>
      <span className="card-head-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <div className="card-head-text">
        <Title level="H5">{title}</Title>
        {subtitle && <span className="card-head-sub">{subtitle}</span>}
      </div>
    </div>
  )
}

/** Shows the message of a failed request (messages from the server are written for end users). */
export function ErrorStrip({ error }: { error: unknown }) {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  return (
    <MessageStrip design="Negative" hideCloseButton data-testid="error">
      {message}
    </MessageStrip>
  )
}

export function ConfirmDialog(props: {
  open: boolean
  title: string
  children: ReactNode
  confirmText: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Dialog
      open={props.open}
      headerText={props.title}
      onClose={props.onCancel}
      data-testid="confirm-dialog"
      footer={
        <Bar
          endContent={
            <>
              <Button design="Negative" disabled={props.busy} onClick={props.onConfirm} data-testid="confirm-yes">
                {props.confirmText}
              </Button>
              <Button design="Transparent" onClick={props.onCancel}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <Text>{props.children}</Text>
    </Dialog>
  )
}

/** Tag without the semantic state icon (an icon that is not bundled renders as a question mark). */
export function Tag(props: ComponentProps<typeof UI5Tag>) {
  return <UI5Tag hideStateIcon {...props} />
}

const GENERATOR_COLOR: Record<string, '6' | '8' | '7' | '9' | '10'> = {
  rules: '8',
  gemini: '6',
  'sap-ai-core': '7',
  manual: '9',
}

export function GeneratorTag({ generator }: { generator: string | null }) {
  if (!generator) return null
  return <Tag colorScheme={GENERATOR_COLOR[generator] ?? '10'}>{generator}</Tag>
}

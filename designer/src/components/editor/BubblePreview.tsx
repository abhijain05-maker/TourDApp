import type { InventoryControl, TourDocument, TourStep } from '../../types'
import Markdown from '../Markdown'

const SIDE_TEXT: Record<string, string> = {
  Top: 'above',
  Bottom: 'below',
  Left: 'to the left of',
  Right: 'to the right of',
  Vertical: 'above or below',
  Horizontal: 'to the left or right of',
}

function whereText(step: TourStep, control: InventoryControl | undefined) {
  if (!step.target) return 'Shown in the middle of the screen.'
  const name = control?.display ?? step.target.controlId ?? step.target.fallbacks[0]?.value ?? 'the control'
  const side = step.placement.replace(/^Preferred/, '').replace(/OrFlip$/, '')
  return `Shown ${SIDE_TEXT[side] ?? 'next to'} “${name}”${step.placement.startsWith('Preferred') ? ', on the other side if there is no room' : ''}.`
}

/** How the step's bubble will read for the user (same structure and look as the real player). */
export default function BubblePreview(props: { doc: TourDocument; step: TourStep; index: number; control?: InventoryControl }) {
  const { doc, step, index } = props
  const last = index === doc.steps.length - 1
  return (
    <div data-testid="bubble-preview">
      <div className="preview-stage">
      <div className="mock-bubble">
        <div className="mock-head">
          <h3 data-testid="preview-title">{step.title}</h3>
          {doc.options.allowSkip && <span aria-hidden="true">×</span>}
        </div>
        <div className="mock-body" data-testid="preview-text">
          <Markdown text={step.text} />
        </div>
        <div className="mock-foot">
          <span className="muted">{doc.options.showProgress ? `Step ${index + 1} of ${doc.steps.length}` : ''}</span>
          <span className="mock-btns">
            <span className={`mock-btn${index === 0 ? ' disabled' : ''}`}>Back</span>
            <span className="mock-btn primary">{last ? 'Done' : 'Next'}</span>
          </span>
        </div>
      </div>
      </div>
      <p className="muted preview-where" data-testid="preview-where">
        {whereText(step, props.control)}
      </p>
    </div>
  )
}

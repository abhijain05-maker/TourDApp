import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, Icon } from '@ui5/webcomponents-react'
import '@ui5/webcomponents-icons/dist/vertical-grip.js'
import '@ui5/webcomponents-icons/dist/duplicate.js'
import '@ui5/webcomponents-icons/dist/delete.js'
import '@ui5/webcomponents-icons/dist/add.js'
import type { TourDocument, TourStep } from '../../types'
import { Tag } from '../common'

export interface StepIssues {
  errors: number
  warnings: number
}

const short = (viewName?: string) => (viewName ?? '').split('.').slice(-1)[0]

function targetLabel(step: TourStep) {
  const t = step.target
  if (!t) return 'no control (centered)'
  return `${short(t.viewName)}${t.viewName ? ' / ' : ''}${t.controlId ?? `"${t.fallbacks[0]?.value ?? '?'}"`}`
}

function Row(props: {
  step: TourStep
  index: number
  selected: boolean
  issues?: StepIssues
  canDelete: boolean
  onSelect: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { step, index, selected, issues } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
  const lowConfidence = (step.meta?.confidence ?? 1) < 0.7 && !step.meta?.unresolved
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className={`step-item${selected ? ' selected' : ''}`}
      data-testid="step-item"
      data-step-id={step.id}
      aria-current={selected ? 'step' : undefined}
      onClick={props.onSelect}
    >
      <button type="button" className="grip" aria-label={`Move step ${index + 1}`} data-testid="step-grip" {...attributes} {...listeners} onClick={(e) => e.stopPropagation()}>
        <Icon name="vertical-grip" />
      </button>
      <span className="step-no">{index + 1}</span>
      <div className="step-main">
        <div className="step-title" data-testid="step-item-title">
          {step.title || <i>(no title)</i>}
        </div>
        <div className="muted step-sub">{targetLabel(step)}</div>
        <div className="row" style={{ gap: '0.25rem' }}>
          {step.meta?.unresolved && <Tag colorScheme="1">needs review</Tag>}
          {lowConfidence && <Tag colorScheme="2">check target</Tag>}
          {!!issues?.errors && <Tag colorScheme="1">{issues.errors} error(s)</Tag>}
          {!!issues?.warnings && <Tag colorScheme="2">{issues.warnings} warning(s)</Tag>}
        </div>
      </div>
      <div className="step-actions">
        <Button icon="duplicate" design="Transparent" tooltip="Duplicate step" data-testid="step-duplicate" onClick={(e) => (e.stopPropagation(), props.onDuplicate())} />
        <Button icon="delete" design="Transparent" tooltip="Delete step" disabled={!props.canDelete} data-testid="step-delete" onClick={(e) => (e.stopPropagation(), props.onDelete())} />
      </div>
    </li>
  )
}

export default function StepList(props: {
  doc: TourDocument
  selectedId: string
  issues: Map<string, StepIssues>
  onSelect: (id: string) => void
  onMove: (from: number, to: number) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = props.doc.steps.map((s) => s.id)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) props.onMove(from, arrayMove(ids, from, to).indexOf(String(active.id)))
  }

  return (
    <div className="stack" data-testid="step-list">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="step-items">
            {props.doc.steps.map((step, i) => (
              <Row
                key={step.id}
                step={step}
                index={i}
                selected={step.id === props.selectedId}
                issues={props.issues.get(step.id)}
                canDelete={props.doc.steps.length > 1}
                onSelect={() => props.onSelect(step.id)}
                onDuplicate={() => props.onDuplicate(step.id)}
                onDelete={() => props.onDelete(step.id)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <Button icon="add" design="Transparent" onClick={props.onAdd} data-testid="step-add">
        Add step
      </Button>
    </div>
  )
}

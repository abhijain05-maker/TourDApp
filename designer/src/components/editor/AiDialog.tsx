import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bar, BusyIndicator, Button, Dialog, Input, Label, MessageStrip, Option, Select } from '@ui5/webcomponents-react'
import { api } from '../../api'
import type { TourRow, TourStep } from '../../types'
import { ErrorStrip } from '../common'

const PRESETS = ['Make it shorter', 'Make it friendlier', 'Explain why the user needs this', 'Translate to German', 'Translate to French']

/** Asks an AI provider to rewrite, shorten, translate or retarget one step. The result is a new, undoable version. */
export default function AiDialog(props: {
  open: boolean
  tourID: string
  step: TourStep
  flush: () => Promise<boolean>
  onClose: () => void
  onDone: (row: TourRow) => void
}) {
  const providers = useQuery({ queryKey: ['providers'], queryFn: api.providers, enabled: props.open })
  const ai = (providers.data ?? []).filter((p) => p.id !== 'rules' && p.configured)
  const [instruction, setInstruction] = useState('')
  const [provider, setProvider] = useState('')
  const chosen = provider || ai[0]?.id || ''

  const run = useMutation({
    mutationFn: async () => {
      if (!(await props.flush())) throw new Error('Fix the problems in the tour first: it can only be edited by the AI once it is valid.')
      return api.refineStep({ tourID: props.tourID, stepID: props.step.id, instruction: instruction.trim(), provider: chosen, model: '' })
    },
    onSuccess: (row) => {
      setInstruction('')
      props.onDone(row)
    },
  })

  return (
    <Dialog
      open={props.open}
      headerText={`Ask AI to edit "${props.step.title}"`}
      onClose={props.onClose}
      data-testid="ai-dialog"
      footer={
        <Bar
          endContent={
            <>
              <Button design="Emphasized" disabled={!chosen || !instruction.trim() || run.isPending} onClick={() => run.mutate()} data-testid="ai-run">
                Apply
              </Button>
              <Button design="Transparent" onClick={props.onClose}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack" style={{ width: 'min(34rem, 85vw)' }}>
        <ErrorStrip error={run.error ?? providers.error} />
        {providers.data && ai.length === 0 && (
          <MessageStrip design="Information" hideCloseButton data-testid="ai-unavailable">
            No AI provider is configured on the server. Set GEMINI_API_KEY or the SAP AI Core credentials (see .env.example).
          </MessageStrip>
        )}
        {ai.length > 0 && (
          <div>
            <Label>Provider</Label>
            <Select style={{ width: '100%' }} onChange={(e) => setProvider(e.detail.selectedOption.value ?? '')}>
              {ai.map((p) => (
                <Option key={p.id} value={p.id} selected={p.id === chosen}>
                  {p.label}
                </Option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label required for="ai-instruction">
            What should change?
          </Label>
          <Input id="ai-instruction" style={{ width: '100%' }} value={instruction} placeholder="e.g. mention that the field is required" onInput={(e) => setInstruction(e.target.value)} data-testid="ai-instruction" />
        </div>
        <div className="row" style={{ gap: '0.4rem' }}>
          {PRESETS.map((p) => (
            <Button key={p} design="Transparent" onClick={() => setInstruction(p)}>
              {p}
            </Button>
          ))}
        </div>
        <MessageStrip design="Information" hideCloseButton>
          The step, its neighbours and the control list are sent to the provider. You can undo the change afterwards.
        </MessageStrip>
        {run.isPending && <BusyIndicator active size="S" text="Waiting for the model…" />}
      </div>
    </Dialog>
  )
}

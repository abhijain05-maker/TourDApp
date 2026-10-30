import { useState } from 'react'
import { Bar, Button, Dialog, Input, Label, TextArea } from '@ui5/webcomponents-react'

/** Lets the user paste the content of one file instead of uploading it. */
export default function PasteDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (path: string, content: string) => void }) {
  const [path, setPath] = useState('webapp/view/Main.view.xml')
  const [content, setContent] = useState('')
  return (
    <Dialog
      open={open}
      headerText="Paste a file"
      onClose={onClose}
      data-testid="paste-dialog"
      footer={
        <Bar
          endContent={
            <>
              <Button design="Emphasized" disabled={!path.trim() || !content.trim()} onClick={() => onAdd(path.trim(), content)} data-testid="paste-add">
                Add
              </Button>
              <Button design="Transparent" onClick={onClose}>
                Cancel
              </Button>
            </>
          }
        />
      }
    >
      <div className="stack" style={{ width: 'min(44rem, 80vw)' }}>
        <div>
          <Label required for="paste-path">
            Path inside the app (decides the kind, e.g. webapp/view/Main.view.xml)
          </Label>
          <Input id="paste-path" style={{ width: '100%' }} value={path} onInput={(e) => setPath(e.target.value)} data-testid="paste-path" />
        </div>
        <div>
          <Label required for="paste-content">
            Content
          </Label>
          <TextArea id="paste-content" rows={14} style={{ width: '100%' }} value={content} onInput={(e) => setContent(e.target.value)} data-testid="paste-content" />
        </div>
      </div>
    </Dialog>
  )
}

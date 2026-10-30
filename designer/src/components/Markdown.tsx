import { Fragment } from 'react'
import { parseMarkdown, type Inline } from '../markdown'

function renderInline(nodes: Inline[]) {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'strong':
        return <strong key={i}>{n.text}</strong>
      case 'em':
        return <em key={i}>{n.text}</em>
      case 'code':
        return <code key={i}>{n.text}</code>
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {n.text}
          </a>
        )
      default:
        return <Fragment key={i}>{n.text}</Fragment>
    }
  })
}

/** Renders a tour text. Pure React elements: nothing from the text is ever interpreted as HTML. */
export default function Markdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) =>
        b.type === 'ul' ? (
          <ul key={i} style={{ margin: '0.25rem 0 0.25rem 1.25rem', padding: 0 }}>
            {b.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ margin: '0.25rem 0' }}>
            {b.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </>
  )
}

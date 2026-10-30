import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Title } from '@ui5/webcomponents-react'

export interface Crumb {
  label: string
  to?: string
}

/** Where the person is: links to the levels above, the current page last (Fiori breadcrumb look). */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {items.map((c, i) => (
          <li key={`${i}-${c.label}`} aria-current={i === items.length - 1 ? 'page' : undefined}>
            {c.to && i < items.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

/** A small, quiet label: the app id, the UI5 version, a status. */
export function Chip(props: { children: ReactNode; tone?: 'neutral' | 'info' | 'good' | 'warn' }) {
  return <span className={`chip ${props.tone ?? 'neutral'}`}>{props.children}</span>
}

/** The top of a page: breadcrumbs, then a banner card with the title, its labels, a line of description, small facts and the page actions. */
export default function PageHeader(props: {
  crumbs: Crumb[]
  title: string
  titleTestId?: string
  chips?: ReactNode
  description?: string | null
  /** small facts under the description, e.g. "Created …" */
  meta?: ReactNode
  actions?: ReactNode
}) {
  const initial = props.title.trim().charAt(0).toUpperCase() || '?'
  return (
    <header className="page-head">
      <Breadcrumbs items={props.crumbs} />
      <div className="page-banner">
        <span className="page-avatar" aria-hidden="true">
          {initial}
        </span>
        <div className="page-banner-body">
          <div className="page-head-main">
            <div className="page-head-title">
              <Title level="H2" data-testid={props.titleTestId}>
                {props.title}
              </Title>
              {props.chips && <div className="chips">{props.chips}</div>}
            </div>
            {props.actions && <div className="page-head-actions">{props.actions}</div>}
          </div>
          {props.description && <p className="page-head-desc">{props.description}</p>}
          {props.meta && <div className="page-head-meta">{props.meta}</div>}
        </div>
      </div>
    </header>
  )
}

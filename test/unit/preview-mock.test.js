import { describe, it, expect } from 'vitest'
import { bindingsOf, inferMockData, sampleValue } from '../../srv/lib/preview/mock.js'

const view = (body) =>
  `<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc" xmlns:core="sap.ui.core">${body}</mvc:View>`

describe('bindingsOf', () => {
  it('reads simple, model-prefixed and complex bindings', () => {
    expect(bindingsOf('{/Orders}')).toEqual([{ model: '', path: '/Orders' }])
    expect(bindingsOf('{customer}')).toEqual([{ model: '', path: 'customer' }])
    expect(bindingsOf('{shop>/Items}')).toEqual([{ model: 'shop', path: '/Items' }])
    expect(bindingsOf("{ path: '/Orders', sorter: { path: 'id' } }")).toEqual([
      { model: '', path: '/Orders' },
    ])
    expect(bindingsOf("{path: 'name', model: 'shop'}")).toEqual([{ model: 'shop', path: 'name' }])
    expect(bindingsOf('Order {id} for {customer}').map((b) => b.path)).toEqual(['id', 'customer'])
  })

  it('skips texts, i18n, expressions and the manifest syntax', () => {
    expect(bindingsOf('Create')).toEqual([])
    expect(bindingsOf('{i18n>title}')).toEqual([])
    expect(bindingsOf('{= ${amount} > 10 }')).toEqual([])
    expect(bindingsOf('{{appTitle}}')).toEqual([])
    expect(bindingsOf(undefined)).toEqual([])
    expect(bindingsOf('{res>x}', new Set(['res']))).toEqual([])
  })
})

describe('sampleValue', () => {
  it('picks a believable value from the field name', () => {
    expect(sampleValue('id', 0)).toBe('1001')
    expect(sampleValue('orderId', 2)).toBe('1003')
    expect(sampleValue('customer', 1)).toBe('Globex')
    expect(sampleValue('status', 0)).toBe('Open')
    expect(sampleValue('createdAt', 0)).toBe('2026-01-10')
    expect(sampleValue('amount', 1)).toBe(499)
    expect(sampleValue('isActive')).toBe(true)
    expect(sampleValue('description', 0)).toBe('Description 1')
  })
})

describe('inferMockData', () => {
  it('builds rows for a list from the bindings of its template', () => {
    const data = inferMockData([
      {
        content: view(`<Table items="{/Orders}"><items><ColumnListItem>
          <Text text="{customer}"/><ObjectNumber number="{amount}"/><Text text="{address/city}"/></ColumnListItem></items></Table>`),
      },
    ])
    expect(data[''].Orders).toHaveLength(4)
    expect(data[''].Orders[0]).toEqual({
      customer: 'Acme Corp',
      amount: 249.5,
      address: { city: 'City 1' },
    })
    expect(data[''].Orders[1].customer).toBe('Globex')
  })

  it('puts data into the model named in the binding and leaves resource models alone', () => {
    const data = inferMockData([
      {
        content: view(
          `<List items="{shop>/Items}"><StandardListItem title="{shop>name}" info="{i18n>x}"/></List><Title text="{shop>/heading}"/>`,
        ),
      },
    ])
    expect(Object.keys(data)).toEqual(['shop'])
    expect(data.shop.Items[0]).toEqual({ name: 'Name 1' })
    expect(data.shop.heading).toBe('Heading 1')
  })

  it('handles nested absolute paths and scalars', () => {
    const data = inferMockData([
      {
        content: view(
          `<Title text="{/order/customer}"/><Input value="{/order/amount}"/><List items="{/order/items}"><StandardListItem title="{name}"/></List>`,
        ),
      },
    ])
    expect(data[''].order.customer).toBe('Acme Corp')
    expect(data[''].order.amount).toBe(249.5)
    expect(data[''].order.items).toHaveLength(4)
  })

  it('does not trip over broken views or views without bindings', () => {
    expect(
      inferMockData([{ content: '<not xml' }, { content: view('<Button text="Hi"/>') }]),
    ).toEqual({})
  })
})

import cds from '@sap/cds'

const { GET, expect } = cds.test(import.meta.dirname + '/../..')

describe('toolchain smoke', () => {
  it('runs on CAP 10', () => {
    expect(cds.version).to.match(/^10\./)
  })

  it('serves TourService and lists the always-available rule provider', async () => {
    const { data } = await GET('/odata/v4/tour/providers()')
    expect(data.value).to.deep.include({
      id: 'rules',
      label: 'Rule-based (no AI)',
      configured: true,
      model: null,
      redaction: true,
    })
  })
})

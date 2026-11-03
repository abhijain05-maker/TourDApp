// What we know about SAP S/4HANA service names. Nothing here is guessed from a project: it only decides which hints
// a person is shown. Add an API to SCENARIOS to show its communication scenario.

/** Standard API -> the communication scenario that usually exposes it (S/4HANA Cloud). Confirm it in the system. */
export const SCENARIOS = {
  API_BUSINESS_PARTNER: 'SAP_COM_0008',
  API_PRODUCT_SRV: 'SAP_COM_0009',
  API_SALES_ORDER_SRV: 'SAP_COM_0109',
  API_PURCHASEORDER_PROCESS_SRV: 'SAP_COM_0053',
}

/** Last segment of an OData path without the version suffix: "/sap/opu/odata/sap/API_X;v=0002/" -> "API_X". */
export function serviceNameOf(path) {
  const parts = String(path ?? '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
  return (parts.pop() ?? '').replace(/;v=\d+$/i, '')
}

/** 'standard' (released S/4HANA API), 'custom' (Z*, Y*, YY1_*, customer namespace) or 'unknown'. */
export function systemType(name, path = '') {
  const n = String(name ?? '').toUpperCase()
  if (/^API_[A-Z0-9_]+$/.test(n) || /^(OP_|C_)[A-Z0-9_]+$/.test(n)) return 'standard'
  if (/^(Z|Y|YY1_|\/[A-Z0-9]+\/)/.test(n)) return 'custom'
  if (/\/sap\/opu\/odata4?\/sap\/(api_|op_)/i.test(path)) return 'standard'
  return 'unknown'
}

/** 'v2' for /sap/opu/odata/..., 'v4' for /sap/opu/odata4/... or a path that says so; undefined when the path does not tell. */
export function versionOfPath(path) {
  const p = String(path ?? '')
  if (/\/sap\/opu\/odata4\//i.test(p) || /\/odata\/v4\//i.test(p)) return 'v4'
  if (/\/sap\/opu\/odata\//i.test(p) || /\/odata\/v2\//i.test(p)) return 'v2'
  return undefined
}

/** Steps to check that a service is switched on in the backend. */
export function activationSteps({ name, path, version, type }) {
  const steps = []
  const scenario = SCENARIOS[String(name).toUpperCase()]
  if (version === 'v4') {
    steps.push(
      `On-premise / private cloud: in the backend run /IWFND/V4_ADMIN and check that the service group of ${name} is published.`,
    )
  } else {
    steps.push(
      `On-premise / private cloud: in the backend run /IWFND/MAINT_SERVICE, find ${name} and check that it is active, its ICF node is active (SICF), and the user has the authorization.`,
    )
  }
  steps.push(
    scenario
      ? `S/4HANA Cloud: the communication scenario ${scenario} (usually) includes ${name}. Check that a communication arrangement exists for it and that the communication user is the one the destination uses.`
      : `S/4HANA Cloud: find the communication scenario that contains ${name} (Communication Scenarios app) and check that a communication arrangement exists for it.`,
  )
  if (type === 'custom')
    steps.push(
      `${name} is a custom service: check that it is published (service binding / SEGW) in this system, not only in the system it was built in.`,
    )
  if (path)
    steps.push(
      `Open ${path}/$metadata with the destination's user: it must answer 200. 404 means the service is not active or the path is wrong, 401 the login is wrong, 403 a role or arrangement is missing.`,
    )
  return steps
}

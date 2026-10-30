import type { Wdi5Settings } from '../../shared/wdi5-plan.mjs'

export const FRAMEWORK_LABEL: Record<Wdi5Settings['framework'], string> = { mocha: 'Mocha', jasmine: 'Jasmine' }
export const AUTH_LABEL: Record<Wdi5Settings['auth'], string> = {
  none: 'No login',
  basic: 'Basic authentication',
  btp: 'SAP BTP / Cloud Foundry login',
  custom: 'Own login form',
}

// Writes generated code the way the project's own code is written (tabs or spaces, quotes, semicolons).
import * as prettier from 'prettier'

/** What the generator writes when a project has nothing to copy from. */
export const DEFAULT_STYLE = { useTabs: false, tabWidth: 4, singleQuote: false, semi: false }

export const sameStyle = (a, b) =>
  !!a &&
  !!b &&
  a.useTabs === b.useTabs &&
  a.tabWidth === b.tabWidth &&
  a.singleQuote === b.singleQuote &&
  a.semi === b.semi

/** @returns {Promise<string>} the code, unchanged when it has the style already or cannot be formatted */
export async function formatCode(code, style) {
  if (!style || sameStyle(style, DEFAULT_STYLE)) return code
  try {
    return await prettier.format(code, {
      parser: 'babel',
      useTabs: style.useTabs,
      tabWidth: style.tabWidth,
      singleQuote: style.singleQuote,
      semi: style.semi,
      trailingComma: 'none',
      printWidth: 100,
    })
  } catch {
    return code
  }
}

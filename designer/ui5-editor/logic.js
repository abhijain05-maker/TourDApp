// The tour logic of the designer for the SAPUI5 app (app/designer-ui5), built into lib/tourd-logic.js (npm run build:ui5-editor).
// The same modules the React designer and the server use, so a tour is checked the same way everywhere.
import playerSource from '../../player/TourPlayer.js?raw'
export { validateTour } from '../../shared/tour-schema.mjs'
export { lintTour } from '../../srv/lib/validate/lint.js'
export { matchRoute, normalizeHash } from '../../srv/lib/parsers/manifest.js'
export { targetFor } from '../../srv/lib/llm/draft.js'
export { buildInlineSnippet, buildLoaderSnippet, toBookmarklet } from '../../shared/live-snippet.mjs'
export { describeIssue } from '../src/editor/describeIssue'
export { hashFor } from '../src/editor/routeHash'
export { parseMarkdown } from '../src/markdown'
export { DEFAULT_SETTINGS } from '../../shared/wdi5-plan.mjs'
export { playerSource }

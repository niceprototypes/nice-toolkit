/**
 * @fileoverview Token-folder templates — get{Component}Token,
 * {Component}Styles, and the folder index.
 *
 * @module creator/templates/tokens
 */

const { toPrefix } = require('./helpers');

/**
 * Token accessor wrapper (src/tokens/get{Component}Token.ts).
 *
 * Forwards both flat and path-based lookups to getComponentToken.
 * Matches the canonical signature from nice-react-typography (standard bearer).
 *
 * @param {string} componentName - PascalCase component name
 * @returns {string}
 */
function getReactTokenFile(componentName) {
  const prefix = toPrefix(componentName);
  return `import { getComponentToken, type TokenResult } from "nice-react-styles"

/**
 * Get a ${prefix} component token.
 *
 * Flat lookup — for tokens at depth 1:
 * \\\`\\\`\\\`ts
 * get${componentName}Token("size", "base")
 * \\\`\\\`\\\`
 *
 * Path lookup — for nested tokens:
 * \\\`\\\`\\\`ts
 * get${componentName}Token(["group", "variant", "parameter"])
 * \\\`\\\`\\\`
 */
export function get${componentName}Token(nameOrPath: string | string[], variantOrMode?: string, mode?: string): TokenResult {
  if (Array.isArray(nameOrPath)) {
    return getComponentToken("${prefix}", nameOrPath, variantOrMode)
  }
  return getComponentToken("${prefix}", nameOrPath, variantOrMode, mode)
}
`;
}

/**
 * No-op styles component kept for backward compatibility — actual CSS
 * variables are emitted by nice-styles' build into dist/tokens.css.
 *
 * @param {string} componentName
 * @returns {string}
 */
function stylesComponentFile(componentName) {
  return `import type { ComponentType } from "react"

export const ${componentName}Styles: ComponentType = () => null
`;
}

/**
 * Re-export index for src/tokens/.
 *
 * @param {string} componentName
 * @returns {string}
 */
function tokensIndex(componentName) {
  return `export { ${componentName}Styles } from "./${componentName}Styles"
export { get${componentName}Token } from "./get${componentName}Token"
`;
}

module.exports = { getReactTokenFile, stylesComponentFile, tokensIndex };

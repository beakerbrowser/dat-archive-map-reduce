const {assert} = require('./util')
const {SchemaError} = require('./errors')

exports.validateAndSanitize = function (definition) {
  // validate and sanitize
  assert(definition && typeof definition === 'object', SchemaError, `Must pass a definition object to db.define(), got ${definition}`)
  assert(definition.path && isStringOrArrayOfStrings(definition.path), SchemaError, `The .path field must be a string or array of strings`)
  assert(definition.map && typeof definition.map === 'function', SchemaError, `The .map field must be a function, got ${typeof definition.map}`)
  assert(!definition.reduce || typeof definition.reduce === 'function', SchemaError, `The .reduce field must be a function, got ${typeof definition.reduce}`)
}

// helpers
// =

function isStringOrArrayOfStrings (v) {
  if (typeof v === 'string') return true
  if (Array.isArray(v)) {
    return v.every(item => typeof item === 'string')
  }
  return false
}
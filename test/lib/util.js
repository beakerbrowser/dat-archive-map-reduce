const tempy = require('tempy')
const DatArchive = require('node-dat-archive')
const DAMR = require('../../index')
const {debug, veryDebug} = require('../../lib/util')

var __counter = 0
exports.newDB = function () {
  const name = 'test' + (++__counter)
  debug('\n##', name, '\n')
  var dir = tempy.directory()
  veryDebug('DB dir:', dir)
  return new DAMR(dir, {DatArchive})
}

exports.reopenDB = function (db) {
  return new DAMR(db.name, {DatArchive})
}

var lastTs = 0
exports.ts = function () {
  var ts = Date.now()
  while (ts <= lastTs) {
    ts++ // cheat to avoid a collision
  }
  lastTs = ts
  return ts
}

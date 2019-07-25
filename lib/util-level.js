const through2 = require('through2')
const concat = require('concat-stream')
const {assert, debug, veryDebug} = require('./util')

exports.push = async function (db, key, value) {
  try {
    var list = await get(db, key)
  } catch (e) {}
  list = list || []
  list.push(value)
  await put(db, key, list)
}

exports.update = async function (db, key, updates) {
  assert(updates && typeof updates === 'object')
  try {
    var record = await get(db, key)
  } catch (e) {}
  record = record || {}
  for (var k in updates) {
    record[k] = updates[k]
  }
  await put(db, key, record)
}

exports.clear = async function (db) {
  return new Promise((resolve, reject) => {
    var stream = db.createKeyStream()
    stream
      .pipe(through2.obj((key, enc, cb) => db.del(key).then(cb, cb)))
      .on('error', reject)
      .on('end', () => resolve())
    stream.resume()
  })
}

const get =
exports.get = async function (db, key) {
  return new Promise((resolve, reject) => {
    db.get(key, (err, value) => {
      if (err) {
        if (err.notFound) resolve(undefined)
        else reject(err)
      } else {
        resolve(value)
      }
    })
  })
}

const put =
exports.put = async function (db, key, value) {
  return new Promise((resolve, reject) => {
    db.put(key, value, (err, value) => {
      if (err) {
        reject(err)
      } else {
        resolve(value)
      }
    })
  })
}

exports.del = async function (db, key) {
  return new Promise((resolve, reject) => {
    db.del(key, (err, value) => {
      if (err) {
        reject(err)
      } else {
        resolve(value)
      }
    })
  })
}

exports.list = async function (db, opts) {
  return new Promise((resolve, reject) => {
    var stream = db.createReadStream(opts)
    stream
      .on('error', reject)
      .pipe(concat(resolve))
    stream.resume()
  })
}

exports.each = async function (db, fn) {
  return new Promise((resolve, reject) => {
    var stream = db.createValueStream()
    stream.on('data', fn)
    stream.on('error', reject)
    stream.on('end', resolve)
    stream.resume()
  })
}

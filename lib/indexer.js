const anymatch = require('anymatch')
const _debounce = require('lodash.debounce')
const View = require('./view')
const LevelUtil = require('./util-level')
const {debug, veryDebug, lock} = require('./util')

const READ_TIMEOUT = 30e3

// typedefs
// =

/**
 * @typedef {Object} RelevantFile
 * @prop {string} url
 * @prop {View} view
 *
 * @typedef {Object} Update
 * @prop {string} type
 * @prop {string} path
 * @prop {number} version
 */

// globals
// =

var archiveFileEvents = {}

// exported api
// =

/**
 * @param {Object} db
 * @param {Object} archive
 * @param {Object} opts
 * @param {boolean} opts.watch
 * @returns {Promise<void>}
 */
exports.addArchive = async function (db, archive, {watch}) {
  veryDebug('Indexer.addArchive', archive.url, {watch})

  // process the archive
  await (
    indexArchive(db, archive)
      .then(() => {
        if (watch) exports.watchArchive(db, archive)
      })
      .catch(e => onFailInitialIndex(e, db, archive, {watch}))
  )
}

/**
 * @param {Object} db
 * @param {Object} archive
 * @returns {Promise<void>}
 */
exports.removeArchive = async function (db, archive) {
  veryDebug('Indexer.removeArchive', archive.url)
  await unindexArchive(db, archive)
  exports.unwatchArchive(db, archive)
}

/**
 * @param {Object} db
 * @param {Object} archive
 * @returns {Promise<void>}
 */
exports.watchArchive = async function (db, archive) {
  veryDebug('Indexer.watchArchive', archive.url)
  if (archiveFileEvents[archive.url]) {
    console.error('watchArchive() called on archive that already is being watched', archive.url)
    return
  }
  if (archive._loadPromise) {
    // HACK node-dat-archive fix
    // Because of a weird API difference btwn node-dat-archive and beaker's DatArchive...
    // ...the event-stream methods need await _loadPromise
    // -prf
    await archive._loadPromise
  }
  archiveFileEvents[archive.url] = archive.createFileActivityStream(db._viewFilePatterns) // TODO switch to watch()
  // autodownload all changes to the watched files
  archiveFileEvents[archive.url].addEventListener('invalidated', ({path}) => archive.download(path))
  // autoindex on changes
  archiveFileEvents[archive.url].addEventListener('changed', _debounce(({path}) => {
    indexArchive(db, archive)
  }, 500))
}

/**
 * @param {Object} db
 * @param {Object} archive
 * @returns {void}
 */
exports.unwatchArchive = function (db, archive) {
  veryDebug('Indexer.unwatchArchive', archive.url)
  if (archiveFileEvents[archive.url]) {
    archiveFileEvents[archive.url].close()
    archiveFileEvents[archive.url] = null
  }
}

/**
 * @param {Object} db
 * @param {string} viewName
 * @returns {Promise<void>}
 */
exports.resetIndex = async function (db, viewName) {
  debug(`Indexer.resetIndex(${viewName})`)
  await db.views[viewName].clearData()
}

/**
 * @desc
 * figure how what changes need to be processed
 * then update the indexes
 *
 * @param {Object} db
 * @param {Object} archive
 * @returns {Promise<void>}
 */
async function indexArchive (db, archive) {
  debug('Indexer.indexArchive', archive.url)
  var release = await lock(`index:${archive.url}`)
  try {
    // sanity check
    if (!db.isOpen && !db.isBeingOpened) {
      return veryDebug('Indexer.indexArchive aborted, not open')
    }
    if (!db.level) {
      return console.log('indexArchive called on corrupted db')
    }

    // fetch the current archive state
    var archiveMeta = await archive.getInfo({timeout: READ_TIMEOUT})

    for (let viewName in db.views) {
      let view = db.views[viewName]
      let version = await LevelUtil.get(view.archiveVersionLevel, archive.url)
      version = +version || 0
      try {
        debug('Indexer.indexArchive', view.name, archive.url, 'start', version, 'end', archiveMeta.version)
        db.emit('archive-indexing', {
          view: view.name,
          origin: archive.url,
          start: version,
          end: archiveMeta.version
        })
      } catch (e) {
        console.error(e)
      }

      // find and apply all changes which haven't yet been processed
      var updates = await scanArchiveHistoryForUpdates(view, archive, {
        start: version + 1,
        end: archiveMeta.version + 1
      })
      await applyUpdates(db, view, archive, updates)
      debug('Indexer.indexArchive applied', updates.length, 'updates from', archive.url, 'in', view.name)

      // emit
      try {
        db.emit('archive-indexed', {
          view: view.name,
          origin: archive.url,
          version: archiveMeta.version
        })
      } catch (e) {
        console.error(e)
      }
    }

    db.emit('indexes-updated', {
      origin: archive.url,
      version: archiveMeta.version
    })
  } finally {
    release()
  }
}
exports.indexArchive = indexArchive

/**
 * @desc
 * delete all records generated from the archive
 *
 * @param {Object} db
 * @param {Object} archive
 * @returns {Promise<void>}
 */
async function unindexArchive (db, archive) {
  var release = await lock(`index:${archive.url}`)
  try {
    // find any relevant records and delete them from the indexes
    var foundFiles = await scanArchiveForRelevantFiles(db, archive)
    await Promise.all(foundFiles.map(foundFile =>
      foundFile.view.clearEntriesByFile(foundFile.url)
    ))
    for (let view of db.views) {
      await LevelUtil.del(view.archiveVersionLevel, archive.url)
    }
  } finally {
    release()
  }
}
exports.unindexArchive = unindexArchive

/**
 * @desc
 * read the file, find the matching table, validate, then store
 *
 * @param {Object} db
 * @param {View} view
 * @param {Object} archive
 * @param {string} filepath
 * @returns {Promise<void>}
 */
async function readAndIndexFile (db, view, archive, filepath) {
  const fileUrl = archive.url + filepath
  try {
    // read file
    let value = await archive.readFile(filepath, {timeout: READ_TIMEOUT})

    // clear past entries for this file
    var oldEntryKeys = await view.getEntryKeysByFile(fileUrl)
    await view.clearEntriesByFile(fileUrl)

    // run map function
    let keys = new Set(oldEntryKeys)
    let entries = []
    let meta = {origin: archive.url, url: fileUrl, pathname: filepath}
    try {
      view.map(value, meta, (key, value) => {
        keys.add(key)
        entries.push({key, value})
      })
    } catch (e) {
      console.error('Error in map function for', view.name)
      throw e
    }

    // store entries
    await view.addEntries(fileUrl, entries)

    // run reduce
    if (view.reduce) {
      for (let key of keys) {
        let acc
        let entries = (await view.getEntries(key)) || []
        for (let entry of entries) {
          acc = view.reduce(acc, entry.value, key)
        }
        await view.putReducedValue(key, acc)
      }
    }
  } catch (e) {
    console.log('Failed to index', fileUrl, e)
    throw e
  }
}
exports.readAndIndexFile = readAndIndexFile

/**
 * @param {Object} db
 * @param {View} view
 * @param {Object} archive
 * @param {string} filepath
 * @returns {Promise<void>}
 */
async function unindexFile (db, view, archive, filepath) {
  const fileUrl = archive.url + filepath
  try {
    // clear past entries for this file
    var oldEntryKeys = await view.getEntryKeysByFile(fileUrl)
    await view.clearEntriesByFile(fileUrl)

    // run reduce
    if (view.reduce) {
      for (let key of oldEntryKeys) {
        let acc
        let entries = await view.getEntries(key)
        for (let entry of entries) {
          acc = view.reduce(acc, entry.value, key)
        }
        await view.putReducedValue(key, acc)
      }
    }
  } catch (e) {
    console.log('Failed to unindex', fileUrl, e)
    throw e
  }
}
exports.unindexFile = unindexFile

// internal methods
// =

/**
 * @desc
 * helper for when the first indexArchive() fails
 * emit an error, and (if it's a timeout) keep looking for the archive
 *
 * @param {Object} e
 * @param {Object} db
 * @param {Object} archive
 * @param {Object} opts
 * @param {boolean} opts.watch
 * @returns {Promise<void>}
 */
async function onFailInitialIndex (e, db, archive, {watch}) {
  if (e.name === 'TimeoutError') {
    debug('Indexer.onFailInitialIndex starting retry loop', archive.url)
    db.emit('archive-missing', {origin: archive.url})
    while (true) {
      veryDebug('Indexer.onFailInitialIndex attempting load', archive.url)
      // try again every 30 seconds
      await new Promise(resolve => setTimeout(resolve, 30e3))
      // still a source?
      if (!db.isOpen || !(archive.url in db._archives)) {
        return
      }
      // re-attempt the index
      try {
        await indexArchive(db, archive)
        veryDebug('Indexer.onFailInitialIndex successfully loaded', archive.url)
        break // made it!
      } catch (e) {
        // abort if we get a non-timeout error
        if (e.name !== 'TimeoutError') {
          veryDebug('Indexer.onFailInitialIndex failed attempt, aborting', archive.url, e)
          return
        }
      }
    }
    // success
    db.emit('archive-found', {origin: archive.url})
    if (watch) exports.watchArchive(db, archive)
  } else {
    db.emit('archive-error', {origin: archive.url, error: e})
  }
}

/**
 * @desc
 * look through the given history slice
 * match against the tables' path patterns
 * return back the *latest* change to each matching changed record, as an array ordered by revision
 *
 * @param {View} view
 * @param {Object} archive
 * @param {Object} opts
 * @param {number} opts.start
 * @param {number} opts.end
 * @returns {Promise<Update[]>}
 */
async function scanArchiveHistoryForUpdates (view, archive, {start, end}) {
  var history = await archive.history({start, end, timeout: READ_TIMEOUT})

  // pull the latest update to each file
  var updates = {}
  history.forEach(update => {
    if (anymatch(view.filePattern, update.path)) {
      updates[update.path] = update
    }
  })

  // return an array ordered by version
  return Object.values(updates).sort((a, b) => a.version - b.version)
}

/**
 * @param {Object} db
 * @param {Object} archive
 * @returns {Promise<RelevantFile[]>}
 */
async function scanArchiveForRelevantFiles (db, archive) {
  var foundFiles = []
  var filepaths = await archive.readdir('/', {recursive: true})
  for (let filepath of filepaths) {
    let url = archive.url + filepath
    for (let view of db.views) {
      if (anymatch(view.filePattern, filepath)) {
        foundFiles.push({url, view})
      }
    }
  }
  return foundFiles
}

/**
 * @desc
 * iterate the updates and apply them one by one,
 * updating the metadata as each is applied successfully
 *
 * @param {Object} db
 * @param {View} view
 * @param {Object} archive
 * @param {Update[]} updates
 * @returns {Promise<void>}
 */
async function applyUpdates (db, view, archive, updates) {
  for (let i = 0; i < updates.length; i++) {
    // process update
    let update = updates[i]
    if (update.type === 'del') {
      await unindexFile(db, view, archive, update.path)
    } else {
      await readAndIndexFile(db, view, archive, update.path)
    }

    // update meta
    await LevelUtil.put(view.archiveVersionLevel, archive.url, update.version)
    try {
      db.emit('archive-index-progress', {
        view: view.name,
        origin: archive.url,
        current: (i + 1),
        total: updates.length
      })
    } catch (e) {
      console.error(e)
    }
  }
}

const EventEmitter = require('events')
const level = require('level-browserify')
const {debug, veryDebug, assert, URL} = require('./lib/util')
const {SchemaError} = require('./lib/errors')
const ViewDef = require('./lib/view-def')
const Indexer = require('./lib/indexer')
const View = require('./lib/view')

class MapReduce extends EventEmitter {
  /**
   * @param {string} [name] 
   * @param {Object} [opts] 
   * @param {Object} [opts.DatArchive]
   */
  constructor (name = 'views', opts = {}) {
    super()
    if (typeof window === 'undefined' && !opts.DatArchive) {
      throw new Error('Must provide {DatArchive} opt when using MapReduce outside the browser.')
    }
    this.level = false
    this.name = name
    this.isBeingOpened = false
    this.isOpen = false
    this.DatArchive = opts.DatArchive || window.DatArchive
    this.views = {}
    this._archives = {}
    this._viewFilePatterns = []
    this._dbReadyPromise = new Promise((resolve, reject) => {
      this.once('open', () => resolve(this))
      this.once('open-failed', reject)
    })
  }

  async open () {
    // guard against duplicate opens
    if (this.isBeingOpened) {
      veryDebug('duplicate open, returning ready promise')
      return this._dbReadyPromise
    }
    if (this.isOpen) {
      return
    }
    this.isBeingOpened = true

    // open the db
    debug('opening')
    try {
      this.level = level(this.name, {valueEncoding: 'json'})

      debug('opened')
      this.isBeingOpened = false
      this.isOpen = true
      this.emit('open')
    } catch (e) {
      console.error('Open has failed', e)
      this.isBeingOpened = false
      this.emit('open-failed', e)
      throw e
    }
  }

  async close () {
    if (!this.isOpen) return
    debug('closing')
    this.isOpen = false
    if (this.level) {
      Object.values(this._archives).forEach(archive => Indexer.unwatchArchive(this, archive))
      this._archives = {}
      await new Promise(resolve => this.level.close(resolve))
      this.level = null
      veryDebug('db .level closed')
    } else {
      veryDebug('db .level didnt yet exist')
    }
  }

  async destroy () {
    if (this.isOpen) {
      await this.close()
    }

    if (typeof level.destroy !== 'function') {
      // TODO add support for node?
      throw new Error('Cannot .destroy() databases outside of the browser environment. You should just delete the files manually.')
    }

    // delete the database from indexeddb
    return new Promise((resolve, reject) => {
      level.destroy(this.name, err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async define (viewName, definition) {
    if (viewName in this.views) {
      throw new SchemaError(`${viewName} has already been defined`)
    }
    await this.open()
    ViewDef.validateAndSanitize(definition)
    this.views[viewName] = new View(this, viewName, definition)

    if (Array.isArray(definition.path)) {
      this._viewFilePatterns = this._viewFilePatterns.concat(definition.path)
    } else {
      this._viewFilePatterns.push(definition.path)
    }
  }

  async reset (viewName) {
    await this.open()
    await Indexer.resetIndex(this, viewName)
    this.emit('view-reset', {view: viewName})
  }

  async get (viewName, key) {
    await this.open()
    return this.views[viewName].get(key)
  }

  async list (viewName, opts={}) {
    await this.open()
    return this.views[viewName].list(opts)
  }

  async index (archive, opts = {watch: false}) {
    await this.open()
    opts.watch = (typeof opts.watch === 'boolean') ? opts.watch : true

    // create our own new DatArchive instance
    archive = typeof archive === 'string' ? new (this.DatArchive)(archive) : archive
    debug('MapReduce.index', archive.url)
    if (!(archive.url in this._archives)) {
      // store and process
      this._archives[archive.url] = archive
      await Indexer.addArchive(this, archive, opts)
    } else {
      await Indexer.indexArchive(this, archive)
    }
  }

  async unindex (archive) {
    await this.open()
    archive = typeof archive === 'string' ? new (this.DatArchive)(archive) : archive
    if (archive.url in this._archives) {
      debug('MapReduce.unindex', archive.url)
      delete this._archives[archive.url]
      await Indexer.removeArchive(this, archive)
    }
  }

  async indexFile (archive, filepath) {
    await this.open()
    if (typeof archive === 'string') {
      const urlp = new URL(archive)
      archive = new (this.DatArchive)(urlp.protocol + '//' + urlp.hostname)
      return this.indexFile(archive, urlp.pathname)
    }
    for (let name in this.views) {
      await Indexer.readAndIndexFile(this, this.views[name], archive, filepath)
    }
  }

  async unindexFile (archive, filepath) {
    await this.open()
    if (typeof archive === 'string') {
      const urlp = new URL(archive)
      archive = new (this.DatArchive)(urlp.protocol + '//' + urlp.hostname)
      return this.indexFile(archive, urlp.pathname)
    }
    for (let name in this.views) {
      await Indexer.unindexFile(this, this.views[name], archive, filepath)
    }
  }

  listIndexed () {
    // TODO pull from DB?
    return Object.keys(this._archives)
  }

  isIndexed (url) {
    // TODO pull from DB?
    if (!url) return false
    if (url.url) url = url.url // an archive
    return (url in this._archives)
  }
}
module.exports = MapReduce

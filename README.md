# dat-archive-map-reduce

Index files in Dat archives with map-reduce to create queryable data views.

**Not yet stable**.

```js
// in beaker
import DatArchiveMapReduce from 'dat://map-reduce.beakerbrowser.com/v/1.0.0/index.js'
// in node
const DatArchiveMapReduce = require('@beaker/dat-archive-map-reduce')

// create instance
const damr = new DatArchiveMapReduce()
```

```js
// define your view
damr.define('site-posts-by-date', {
  path: '/.data/unwalled.garden/posts/*.json',
  map (value, meta, emit) {
    let obj = JSON.parse(value)
    if (isPost(obj)) {
      let timestamp = Number(new Date(obj.createdAt))
      emit([meta.origin, timestamp], meta.url)
    }
  }
})
function isPost (obj) {
  if (obj.type !== 'unwalled.garden/post') return false
  if (!obj.content || typeof obj.content !== 'string') return false
  if (!obj.createdAt || typeof obj.createdAt !== 'string') return false
  return true
}

// index sites
damr.index('dat://pfrazee.com', {watch: true})
damr.index('dat://mafintosh.com', {watch: true})
damr.index('dat://andrewosh.com', {watch: true})

// list the most recent 30 posts by pfrazee.com
await damr.list('site-posts-by-date', {
  gt: ['dat://pfrazee.com', 0],
  lt: ['dat://pfrazee.com', Infinity],
  limit: 30,
  reverse: true
})
// list the posts in the last 5 days by mafintosh.com
await damr.list('site-posts-by-date', {
  gte: ['dat://mafintosh.com', Date.now() - ms('5d')],
  lte: ['dat://mafintosh.com', Date.now()],
  reverse: true
})
```

```js
// reduce example
damr.define('site-posts-count', {
  path: '/.data/unwalled.garden/posts/*.json',
  map (value, meta, emit) {
    let obj = JSON.parse(value)
    if (isPost(obj)) {
      emit(meta.origin, meta.pathname)
    }
  },
  reduce (acc, value, key) {
    return (acc||0) + 1
  }
})
await damr.get('site-posts-count', 'dat://pfrazee.com')
```

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Table of Contents**  *generated with [DocToc](https://github.com/thlorenz/doctoc)*

- [Class: DatArchiveMapReduce](#class-datarchivemapreduce)
  - [new DatArchiveMapReduce([name, opts])](#new-datarchivemapreducename-opts)
- [Instance: DatArchiveMapReduce](#instance-datarchivemapreduce)
  - [damr.open()](#damropen)
  - [damr.close()](#damrclose)
  - [damr.destroy()](#damrdestroy)
  - [damr.define(name, definition)](#damrdefinename-definition)
  - [damr.reset(view)](#damrresetview)
  - [damr.get(view, key)](#damrgetview-key)
  - [damr.list(view, opts)](#damrlistview-opts)
  - [damr.index(url[, opts])](#damrindexurl-opts)
  - [damr.unindex(url)](#damrunindexurl)
  - [damr.indexFile(archive, filepath)](#damrindexfilearchive-filepath)
  - [damr.indexFile(url)](#damrindexfileurl)
  - [damr.unindexFile(archive, filepath)](#damrunindexfilearchive-filepath)
  - [damr.unindexFile(url)](#damrunindexfileurl)
  - [damr.listIndexed()](#damrlistindexed)
  - [damr.isIndexed(url)](#damrisindexedurl)
  - [Event: 'open'](#event-open)
  - [Event: 'open-failed'](#event-open-failed)
  - [Event: 'view-reset'](#event-view-reset)
  - [Event: 'archive-indexing'](#event-archive-indexing)
  - [Event: 'archive-index-progress'](#event-archive-index-progress)
  - [Event: 'archive-indexed'](#event-archive-indexed)
  - [Event: 'archive-missing'](#event-archive-missing)
  - [Event: 'archive-found'](#event-archive-found)
  - [Event: 'archive-error'](#event-archive-error)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Class: DatArchiveMapReduce

### new DatArchiveMapReduce([name, opts])

```js
var damr = new DatArchiveMapReduce('views')
```

 - `name` String. Defaults to `'views'`. If run in the browser, this will be the name of the IndexedDB instance. If run in NodeJS, this will be the path of the LevelDB folder.
 - `opts` Object.
   - `DatArchive` Constructor. The class constructor for dat archive instances. If in node, you should specify [node-dat-archive](https://npm.im/node-dat-archive).

Create a new `DatArchiveMapReduce` instance.
The given `name` will control where the indexes are saved.
You can specify different names to run multiple DatArchiveMapReduce instances at once.

## Instance: DatArchiveMapReduce

### damr.open()

```js
await damr.open()
```

 - Returns Promise&lt;Void&gt;.

Opens the internal databases. Will be called automatically by other methods, so you usually don't need to call this method.

### damr.close()

```js
await damr.close()
```

 - Returns Promise&lt;Void&gt;.

Closes the DatArchiveMapReduce instance.

### damr.destroy()

```js
await damr.destroy()
```

 - Returns Promise&lt;Void&gt;.

Closes and deletes all indexes in the DatArchiveMapReduce instance.

You can `.destroy()` and then `.open()` a DatArchiveMapReduce to recreate its indexes.

```js
await damr.destroy()
await damr.open()
```

### damr.define(name, definition)

 - `name` String. The name of the view.
 - `definition` Object.
   - `path` String or Array&lt;String&gt;. An [anymatch](https://www.npmjs.com/package/anymatch) list of files to index.
   - `map` Function(value, meta, emit). A method to accept a new or changed file and emit new stored entries in the view.
     - `value` String.
     - `meta` Object.
       - `url` String. The URL of the file (eg 'dat://foo.com/bar.json').
       - `origin` String. The origin of the file's site (eg 'dat://foo.com').
       - `pathname` String. The path of the file in the site (eg '/bar.json').
     - `emit` Function(key, value). Call this to emit new mapped values.
       - `key` String or Array&lt;String&gt;. The key to store the new entry at.
       - `value` Any. The value to store for the entry.
   - `reduce` Function(agg, value, key). A method to aggregate mapped entries into a single value.
     - `agg` Any. The current value of the reduce method's output.
     - `value` Any. The next mapped value to process.
     - `key` Any. The key of the entry being processed.
     - Must return the current value of the reduced entry.
 - Returns Promise&lt;Void&gt;.

Creates a new view on the `damr` object.

Example:

```js
// create a view that counts the number of posts by each user
damr.define('site-posts-count', {
  path: '/.data/unwalled.garden/posts/*.json',
  map (value, meta, emit) {
    let obj = JSON.parse(value)
    if (isPost(obj)) {
      emit(meta.origin, meta.pathname)
    }
  },
  reduce (acc, value, key) {
    return (acc||0) + 1
  }
})

// get the number of posts by dat://pfrazee.com
await damr.index('dat://pfrazee.com')
await damr.get('site-posts-count', 'dat://pfrazee.com')
```

### damr.reset(view)

```js
await damr.reset('site-posts-by-date')
```

 - `view` String. The name of the view to reset.

Clears all data indexed in the view. This should be used when the view-definition has changed and needs to be rebuilt.

### damr.get(view, key)

```js
// get the post by pfrazee.com that was created at "Tue, 23 Jul 2019 18:23:57 GMT"
var post = await damr.get('site-posts-by-date', ['dat://pfrazee.com', Number(new Date('Tue, 23 Jul 2019 18:23:57 GMT'))])
```

 - `view` String. The name of the view to query.
 - `key` Any. The key of the entry to fetch.
 - Returns Promise&lt;Any&gt;.

Get the entry at the given key.

### damr.list(view, opts)

```js
// list the most recent 30 posts by pfrazee.com
await damr.list('site-posts-by-date', {
  gte: ['dat://pfrazee.com', 0],
  lte: ['dat://pfrazee.com', Infinity],
  limit: 30,
  reverse: true
})
// list the posts in the last 5 days by mafintosh.com
await damr.list('site-posts-by-date', {
  gte: ['dat://mafintosh.com', Date.now() - ms('5d')],
  lte: ['dat://mafintosh.com', Date.now()],
  reverse: true
})
```

 - `view` String. The name of the view to query.
 - `opts` Object.
   - `gt` Any. The start key in the range to query (exclusive).
   - `gte` Any. The start key in the range to query (inclusive).
   - `lt` Any. The end key in the range to query (exclusive).
   - `lte` Any. The end key in the range to query (inclusive).
   - `reverse` Boolean. Reverse the order of the output? Defaults to false.
   - `limit` Number. Limit the number of entries returned. Defaults to no limit.
 - Returns Promise&lt;Array&lt;Any&gt;&gt;.

List a range of entries from a view.

### damr.index(url[, opts])

```js
await damr.index('dat://foo.com')
```

 - `url` String or DatArchive. The site to index.
 - `opts` Object.
   - `watch` Boolean. Should DatArchiveMapReduce watch the archive for changes, and index them immediately? Defaults to false.
 - Returns Promise&lt;Void&gt;.

Add a dat:// site to be indexed.
The method will return when the site has been fully indexed.

### damr.unindex(url)

```js
await damr.unindex('dat://foo.com')
```

 - `url` String or DatArchive. The site to deindex.
 - Returns Promise&lt;Void&gt;.

Remove a dat:// site from the dataset.
The method will return when the site has been fully de-indexed.

### damr.indexFile(archive, filepath)

```js
await damr.indexFile(fooArchive, '/bar.json')
```

 - `archive` DatArchive. The site containing the file to index.
 - `filepath` String. The path of the file to index.
 - Returns Promise&lt;Void&gt;.

Add a single file to the dataset.
The method will return when the file has been indexed.

This will not add the file or its archive to the list returned by `listIndexed()`.
DatArchiveMapReduce will not watch the file after this call.

### damr.indexFile(url)

```js
await damr.indexFile('dat://foo.com/bar.json')
```

 - `url` String. The url of the file to index.
 - Returns Promise&lt;Void&gt;.

Add a single file to the dataset.
The method will return when the file has been indexed.

This will not add the file or its archive to the list returned by `listIndexed()`.
DatArchiveMapReduce will not watch the file after this call.

### damr.unindexFile(archive, filepath)

```js
await damr.unindexFile(fooArchive, '/bar.json')
```

 - `archive` DatArchive. The site containing the file to deindex.
 - `filepath` String. The path of the file to deindex.
 - Returns Promise&lt;Void&gt;.

Remove a single file from the dataset.
The method will return when the file has been de-indexed.

### damr.unindexFile(url)

```js
await damr.unindexFile('dat://foo.com/bar.json')
```

 - `url` String. The url of the file to deindex.
 - Returns Promise&lt;Void&gt;.

Remove a single file from the dataset.
The method will return when the file has been de-indexed.

### damr.listIndexed()

```js
var urls = await damr.listIndexed()
```

 - Returns Array&lt;String&gt;.

Lists the URLs of the dat:// sites which are included in the dataset.

### damr.isIndexed(url)

```js
var yesno = await damr.isIndexed('dat://foo.com')
```

 - Returns Boolean.

Is the given dat:// URL included in the dataset?

### Event: 'open'

```js
damr.on('open', () => {
  console.log('DatArchiveMapReduce is ready for use')
})
```

Emitted when the DatArchiveMapReduce instance has been opened using [`open()`](#damropen).

### Event: 'open-failed'

```js
damr.on('open-failed', (err) => {
  console.log('DatArchiveMapReduce failed to open', err)
})
```

 - `error` Error.

Emitted when the DatArchiveMapReduce instance fails to open during [`open()`](#damropen).

### Event: 'view-reset'

```js
damr.on('view-reset', ({view}) => {
  console.log('DatArchiveMapReduce has reset the indexes for', view)
})
```

- `view` String. The name of the view that was reset.

Emitted when `reset()` has been called on a view. All map/reduced entries are cleared for the view.

### Event: 'archive-indexing'

```js
damr.on('archive-indexing', ({view, origin, start, end}) => {
  console.log(view, 'is updating for', origin, 'from version', start, 'to', end)
})
```

 - `view` String. The view that is indexing.
 - `origin` String. The archive that was updated.
 - `start` Number. The version which is being indexed from.
 - `end` Number. The version which is being indexed to.

Emitted when the DatArchiveMapReduce instance has started to index the given archive.

### Event: 'archive-index-progress'

```js
damr.on('archive-index-progress', ({view, origin, current, total}) => {
  console.log(view, 'update for', origin, 'is', Math.round(current / total * 100), '% complete')
})
```

 - `view` String. The view that is indexing.
 - `origin` String. The archive that was updated.
 - `current` Number. The current update being applied.
 - `total` Number. The total number of updates being applied.

Emitted when an update has been applied during an indexing process.

### Event: 'archive-indexed'

```js
damr.on('archive-indexed', ({view, origin, version}) => {
  console.log(view, 'was updated for', url, 'at version', version)
})
```

 - `view` String. The view that is indexing.
 - `origin` String. The archive that was updated.
 - `version` Number. The version which was updated to.

Emitted when the DatArchiveMapReduce instance has indexed the given archive.
This is similar to `'view-updated'`, but it fires every time a archive is indexed, whether or not it results in updates to the indexes.

### Event: 'archive-missing'

```js
damr.on('archive-missing', ({origin}) => {
  console.log('DatArchiveMapReduce couldnt find', origin, '- now searching')
})
```

 - `origin` String. The archive that is missing.

Emitted when a archive's data was not locally available or found on the network.
When this occurs, DatArchiveMapReduce will continue searching for the data, and emit `'archive-found'` on success.

### Event: 'archive-found'

```js
damr.on('archive-found', ({origin}) => {
  console.log('DatArchiveMapReduce has found and indexed', origin)
})
```
 
 - `origin` String. The archive that was found.

Emitted when a archive's data was found after originally not being found during indexing.
This event will only be emitted after `'archive-missing'` is emitted.

### Event: 'archive-error'

```js
damr.on('archive-error', ({origin, error}) => {
  console.log('DatArchiveMapReduce failed to index', origin, error)
})
```

 - `origin` String. The archive that failed.
 - `error` Error. The error emitted.

Emitted when an archive fails to load.

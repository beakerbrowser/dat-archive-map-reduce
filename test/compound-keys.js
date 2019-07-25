const test = require('ava')
const {newDB, ts} = require('./lib/util')
const DatArchive = require('node-dat-archive')
const tempy = require('tempy')

test.before(() => console.log('compound-keys.js'))

var archives = []

async function setupNewDB (indexOpts) {
  async function def (fn) {
    const a = await DatArchive.create({localPath: tempy.directory()})
    await a.mkdir('/multi')
    const write = (path, record) => a.writeFile(path, JSON.stringify(record))
    await fn(write, a)
    return a
  }
  archives = []
  for (let i = 0; i < 10; i++) {
    archives.push(await def(async write => {
      await write('/single.json', {first: 'first' + i, second: i, third: 'third' + i + 'single'})
      await write('/multi/1.json', {first: 'first' + i, second: (i+1)*100, third: 'third' + i + 'multi1'})
      await write('/multi/2.json', {first: 'first' + i, second: i, third: 'third' + i + 'multi2'})
      await write('/multi/3.json', {first: 'first' + i + 'b', second: i, third: 'third' + i + 'multi3'})
    }))
  }

  const testDB = newDB()
  testDB.define('single', {
    path: '/single.json',
    map (value, meta, emit) {
      let obj = JSON.parse(value)
      emit([meta.origin, obj.first], meta.url)
    }
  })
  testDB.define('single-reduced', {
    path: '/single.json',
    map (value, meta, emit) {
      let obj = JSON.parse(value)
      emit([meta.origin, obj.first], 1)
    },
    reduce (acc, value, key) {
      return (acc||0) + 1
    }
  })
  testDB.define('multi', {
    path: '/multi/*.json',
    map (value, meta, emit) {
      let obj = JSON.parse(value)
      emit([meta.origin, obj.first], meta.url)
    }
  })
  testDB.define('multi-reduced', {
    path: '/multi/*.json',
    map (value, meta, emit) {
      let obj = JSON.parse(value)
      emit([meta.origin, obj.first], 1)
    },
    reduce (acc, value, key) {
      return (acc||0) + 1
    }
  })
  for (let a of archives) {
    await testDB.index(a, indexOpts)
  }
  return testDB
}

test('get()', async t => {
  const testDB = await setupNewDB()

  t.deepEqual(await testDB.get('single', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: 1})
  t.deepEqual(await testDB.get('single-reduced', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: 1})
  t.deepEqual(await testDB.get('multi', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: 2})
  t.deepEqual(await testDB.get('multi-reduced', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: 2})

  await testDB.close()
})

test('list()', async t => {
  const testDB = await setupNewDB()

  var res1 = await testDB.list('single')
  t.is(res1.length, archives.length)
  for (let i = 0; i < res1.length; i++) {
    let ai = archives.findIndex(a => a.url === res1[i].key[0])
    t.deepEqual(res1[i], {key: [archives[ai].url, `first${ai}`], value: archives[ai].url + '/single.json'})
  }

  var res2 = await testDB.list('single-reduced')
  t.is(res2.length, archives.length)
  for (let i = 0; i < archives.length; i++) {
    t.is(res2[i].value, 1)
  }
  
  var res3 = await testDB.list('multi')
  t.is(res3.length, archives.length * 3)
  for (let i = 0; i < archives.length; i++) {
    let ai = archives.findIndex(a => a.url === res3[i*3].key[0])
    t.deepEqual(res3[i*3 + 0], {key: [archives[ai].url, `first${ai}`], value: archives[ai].url + '/multi/1.json'})
    t.deepEqual(res3[i*3 + 1], {key: [archives[ai].url, `first${ai}`], value: archives[ai].url + '/multi/2.json'})
    t.deepEqual(res3[i*3 + 2], {key: [archives[ai].url, `first${ai}b`], value: archives[ai].url + '/multi/3.json'})
  }

  var res4 = await testDB.list('multi-reduced')
  t.is(res4.length, archives.length * 2)
  for (let i = 0; i < archives.length; i++) {
    t.is(res4[i*2 + 0].value, 2)
    t.is(res4[i*2 + 1].value, 1)
  }

  var res5 = await testDB.list('single', {gt: [archives[4].url, 'first4']})
  t.truthy(res5.length < archives.length)
  for (let i = 0; i < res5.length; i++) {
    let ai = archives.findIndex(a => a.url === res5[i].key[0])
    t.deepEqual(res5[i].key, [archives[ai].url, `first${ai}`])
  }

  var res6 = await testDB.list('single', {gt: [archives[4].url, 'first4']})
  t.truthy(res6.length < archives.length)
  for (let i = 0; i < res6.length; i++) {
    let ai = archives.findIndex(a => a.url === res6[i].key[0])
    t.deepEqual(res6[i].key, [archives[ai].url, `first${ai}`])
  }

  var res7 = await testDB.list('single', {reverse: true})
  var res7b = await testDB.list('single', {reverse: false})
  t.deepEqual(res7, res7b.reverse())

  var res8 = await testDB.list('single', {limit: 3})
  var res8b = await testDB.list('single', {limit: undefined})
  t.is(res8.length, 3)
  t.deepEqual(res8, res8b.slice(0, 3))

  await testDB.close()
})

test('correctly index changed files', async t => {
  const testDB = await setupNewDB()

  // test initial
  t.deepEqual(await testDB.get('single', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: 1})
  t.deepEqual(await testDB.get('single-reduced', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: 1})
  t.deepEqual(await testDB.get('multi', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', [archives[0].url, 'first0']), {key: [archives[0].url, 'first0'], value: 2})
  t.deepEqual(await testDB.get('multi-reduced', [archives[1].url, 'first1']), {key: [archives[1].url, 'first1'], value: 2})

  // make changes & index
  for (let i = 0; i < 10; i++) {
    await archives[i].writeFile('/single.json', JSON.stringify({first: 'first' + (10 - i), second: i, third: 'third' + i + 'single'}))
    await archives[i].writeFile('/multi/1.json', JSON.stringify({first: 'first' + (10 - i), second: (i+1)*100, third: 'third' + i + 'multi1'}))
    await archives[i].writeFile('/multi/2.json', JSON.stringify({first: 'first' + (10 - i), second: i, third: 'third' + i + 'multi2'}))
    await archives[i].writeFile('/multi/3.json', JSON.stringify({first: 'first' + (10 - i) + 'b', second: i, third: 'third' + i + 'multi3'}))
  }
  for (let a of archives) {
    await testDB.index(a)
  }

  // test changed
  t.deepEqual(await testDB.get('single', [archives[0].url, 'first10']), {key: [archives[0].url, 'first10'], value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', [archives[1].url, 'first9']), {key: [archives[1].url, 'first9'], value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', [archives[0].url, 'first10']), {key: [archives[0].url, 'first10'], value: 1})
  t.deepEqual(await testDB.get('single-reduced', [archives[1].url, 'first9']), {key: [archives[1].url, 'first9'], value: 1})
  t.deepEqual(await testDB.get('multi', [archives[0].url, 'first10']), {key: [archives[0].url, 'first10'], value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', [archives[1].url, 'first9']), {key: [archives[1].url, 'first9'], value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', [archives[0].url, 'first10']), {key: [archives[0].url, 'first10'], value: 2})
  t.deepEqual(await testDB.get('multi-reduced', [archives[1].url, 'first9']), {key: [archives[1].url, 'first9'], value: 2})

  await testDB.close()
})

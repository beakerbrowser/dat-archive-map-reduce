const test = require('ava')
const {newDB, ts} = require('./lib/util')
const DatArchive = require('node-dat-archive')
const tempy = require('tempy')

test.before(() => console.log('view.js'))

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
      emit(obj.first, meta.url)
    }
  })
  testDB.define('single-reduced', {
    path: '/single.json',
    map (value, meta, emit) {
      emit(meta.origin, 1)
    },
    reduce (acc, value, key) {
      return (acc||0) + 1
    }
  })
  testDB.define('multi', {
    path: '/multi/*.json',
    map (value, meta, emit) {
      let obj = JSON.parse(value)
      emit(obj.first, meta.url)
    }
  })
  testDB.define('multi-reduced', {
    path: '/multi/*.json',
    map (value, meta, emit) {
      emit(meta.origin, 1)
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

  t.deepEqual(await testDB.get('single', 'first0'), {key: 'first0', value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', 'first1'), {key: 'first1', value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', archives[0].url), {key: archives[0].url, value: 1})
  t.deepEqual(await testDB.get('single-reduced', archives[1].url), {key: archives[1].url, value: 1})
  t.deepEqual(await testDB.get('multi', 'first0'), {key: 'first0', value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', 'first1'), {key: 'first1', value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', archives[0].url), {key: archives[0].url, value: 3})
  t.deepEqual(await testDB.get('multi-reduced', archives[1].url), {key: archives[1].url, value: 3})

  await testDB.close()
})

test('list()', async t => {
  const testDB = await setupNewDB()

  var res1 = await testDB.list('single')
  t.is(res1.length, archives.length)
  for (let i = 0; i < archives.length; i++) {
    t.deepEqual(res1[i], {key: `first${i}`, value: archives[i].url + '/single.json'})
  }

  var res2 = await testDB.list('single-reduced')
  t.is(res2.length, archives.length)
  for (let i = 0; i < archives.length; i++) {
    t.is(res2[i].value, 1)
  }
  
  var res3 = await testDB.list('multi')
  t.is(res3.length, archives.length * 3)
  for (let i = 0; i < archives.length; i++) {
    t.deepEqual(res3[i*3 + 0], {key: `first${i}`, value: archives[i].url + '/multi/1.json'})
    t.deepEqual(res3[i*3 + 1], {key: `first${i}`, value: archives[i].url + '/multi/2.json'})
    t.deepEqual(res3[i*3 + 2], {key: `first${i}b`, value: archives[i].url + '/multi/3.json'})
  }

  var res4 = await testDB.list('multi-reduced')
  t.is(res4.length, archives.length)
  for (let i = 0; i < archives.length; i++) {
    t.is(res4[i].value, 3)
  }

  var res5 = await testDB.list('single', {gt: 'first4'})
  t.is(res5.length, archives.length - 5)
  for (let i = 5; i < archives.length; i++) {
    t.deepEqual(res5[i - 5], {key: `first${i}`, value: archives[i].url + '/single.json'})
  }

  var res6 = await testDB.list('single', {gte: 'first4'})
  t.is(res6.length, archives.length - 4)
  for (let i = 4; i < archives.length; i++) {
    t.deepEqual(res6[i - 4], {key: `first${i}`, value: archives[i].url + '/single.json'})
  }

  var res7 = await testDB.list('single', {lt: 'first5'})
  t.is(res7.length, archives.length - 5)
  for (let i = 0; i < archives.length - 5; i++) {
    t.deepEqual(res7[i], {key: `first${i}`, value: archives[i].url + '/single.json'})
  }

  var res7 = await testDB.list('single', {lte: 'first5'})
  t.is(res7.length, archives.length - 4)
  for (let i = 0; i < archives.length - 4; i++) {
    t.deepEqual(res7[i], {key: `first${i}`, value: archives[i].url + '/single.json'})
  }

  var res8 = await testDB.list('single', {reverse: true})
  t.is(res8.length, archives.length)
  for (let i = 0; i < archives.length; i++) {
    t.deepEqual(res8[archives.length - i - 1], {key: `first${i}`, value: archives[i].url + '/single.json'})
  }

  var res9 = await testDB.list('single', {limit: 3})
  t.is(res9.length, 3)
  for (let i = 0; i < 3; i++) {
    t.deepEqual(res9[i], {key: `first${i}`, value: archives[i].url + '/single.json'})
  }

  await testDB.close()
})

test('correctly index changed files', async t => {
  const testDB = await setupNewDB()

  // test initial
  t.deepEqual(await testDB.get('single', 'first0'), {key: 'first0', value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', 'first1'), {key: 'first1', value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', archives[0].url), {key: archives[0].url, value: 1})
  t.deepEqual(await testDB.get('single-reduced', archives[1].url), {key: archives[1].url, value: 1})
  t.deepEqual(await testDB.get('multi', 'first0'), {key: 'first0', value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', 'first1'), {key: 'first1', value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', archives[0].url), {key: archives[0].url, value: 3})
  t.deepEqual(await testDB.get('multi-reduced', archives[1].url), {key: archives[1].url, value: 3})

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
  t.deepEqual(await testDB.get('single', 'first10'), {key: 'first10', value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', 'first9'), {key: 'first9', value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', archives[0].url), {key: archives[0].url, value: 1})
  t.deepEqual(await testDB.get('single-reduced', archives[1].url), {key: archives[1].url, value: 1})
  t.deepEqual(await testDB.get('multi', 'first10'), {key: 'first10', value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', 'first9'), {key: 'first9', value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', archives[0].url), {key: archives[0].url, value: 3})
  t.deepEqual(await testDB.get('multi-reduced', archives[1].url), {key: archives[1].url, value: 3})

  await testDB.close()
})

test('correctly index changed files (using watch)', async t => {
  const testDB = await setupNewDB({watch: true})

  // test initial
  t.deepEqual(await testDB.get('single', 'first0'), {key: 'first0', value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', 'first1'), {key: 'first1', value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', archives[0].url), {key: archives[0].url, value: 1})
  t.deepEqual(await testDB.get('single-reduced', archives[1].url), {key: archives[1].url, value: 1})
  t.deepEqual(await testDB.get('multi', 'first0'), {key: 'first0', value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', 'first1'), {key: 'first1', value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', archives[0].url), {key: archives[0].url, value: 3})
  t.deepEqual(await testDB.get('multi-reduced', archives[1].url), {key: archives[1].url, value: 3})

  // make changes & index
  var ps = [], resolves = []
  for (let i = 0; i < 10; i++) {
    ps.push(new Promise((resolve, reject) => {
      resolves.push(resolve)
    }))
  }
  testDB.on('indexes-updated', ({origin, version}) => {
    for (let i = 0; i < 10; i++) {
      if (origin === archives[i].url) resolves[i]()
    }
  })
  for (let i = 0; i < 10; i++) {
    await archives[i].writeFile('/single.json', JSON.stringify({first: 'first' + (10 - i), second: i, third: 'third' + i + 'single'}))
    await archives[i].writeFile('/multi/1.json', JSON.stringify({first: 'first' + (10 - i), second: (i+1)*100, third: 'third' + i + 'multi1'}))
    await archives[i].writeFile('/multi/2.json', JSON.stringify({first: 'first' + (10 - i), second: i, third: 'third' + i + 'multi2'}))
    await archives[i].writeFile('/multi/3.json', JSON.stringify({first: 'first' + (10 - i) + 'b', second: i, third: 'third' + i + 'multi3'}))
  }
  await Promise.all(ps)

  // test changed
  t.deepEqual(await testDB.get('single', 'first10'), {key: 'first10', value: [archives[0].url + '/single.json']})
  t.deepEqual(await testDB.get('single', 'first9'), {key: 'first9', value: [archives[1].url + '/single.json']})
  t.deepEqual(await testDB.get('single-reduced', archives[0].url), {key: archives[0].url, value: 1})
  t.deepEqual(await testDB.get('single-reduced', archives[1].url), {key: archives[1].url, value: 1})
  t.deepEqual(await testDB.get('multi', 'first10'), {key: 'first10', value: [archives[0].url + '/multi/1.json', archives[0].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi', 'first9'), {key: 'first9', value: [archives[1].url + '/multi/1.json', archives[1].url + '/multi/2.json']})
  t.deepEqual(await testDB.get('multi-reduced', archives[0].url), {key: archives[0].url, value: 3})
  t.deepEqual(await testDB.get('multi-reduced', archives[1].url), {key: archives[1].url, value: 3})

  await testDB.close()
})
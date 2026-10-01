// Exercise production storage in an isolated config directory, never the user's config.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = path.join(__dirname,'..','core','storage.js');
const isolated = path.join(__dirname,'..','.test-artifacts','preferences');
const sandbox = {
  __dirname:path.join(isolated,'core'), console, module:{exports:{}},
  require:name => name === 'electron' ? {ipcMain:{handle(){},on(){}}} : require(name),
};
vm.runInNewContext(fs.readFileSync(source,'utf8'),sandbox,{filename:source});
const storage=sandbox.module.exports;
const value={likes:[{path:'one.mp3',ts:1}],collections:[{id:'1',name:'Music',songs:['one.mp3']}],
  stats:{'one.mp3':{plays:20,duration:1000,recentDays:{'2026-10-01':{plays:1,duration:4}}}},
  settings:{interfaceMode:'classic',volume:.7},genreOverrides:{'one.mp3':['Jazz'],'two.mp3':[]}};
assert.equal(storage.writeUserData(value),true);
const saved=JSON.parse(fs.readFileSync(path.join(isolated,'config','userdata.json'),'utf8'));
assert.deepEqual(saved.genreOverrides,value.genreOverrides);
assert.deepEqual(saved.stats,value.stats);
assert.deepEqual(saved.settings,value.settings);
assert.equal(JSON.stringify(storage.readUserData().genreOverrides),JSON.stringify(value.genreOverrides));
assert.equal(JSON.stringify(storage.readUserData().stats),JSON.stringify(value.stats));
console.log('Passed: production storage preserves interface preference, daily history and manual genre labels');

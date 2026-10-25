'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { visibleGroupLabelOffset: fit } = require('../public/table-group-follow.js');

test('group labels remain centered when their entire group is visible', () => {
  assert.deepEqual(fit({left:100,right:400},{left:0,right:600},0,false),{offset:0,maxWidth:288});
});
test('partially hidden group labels follow the visible portion during horizontal scroll', () => {
  assert.deepEqual(fit({left:-200,right:500},{left:0,right:400},0,false),{offset:50,maxWidth:388});
  assert.deepEqual(fit({left:-200,right:500},{left:0,right:400},120,false),{offset:110,maxWidth:268});
});
test('frozen group titles remain within the frozen area', () => {
  assert.deepEqual(fit({left:0,right:160},{left:0,right:500},120,true),{offset:-20,maxWidth:108});
});
test('group titles do not render when the group is outside the readable viewport', () => {
  assert.equal(fit({left:-300,right:-20},{left:0,right:500},0,false),null);
  assert.equal(fit({left:10,right:120},{left:0,right:500},130,false),null);
});

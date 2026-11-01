'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let proto;

function load() {
  if (proto) return proto;

  const scope = { Uint8Array, ArrayBuffer };
  scope.window = scope;
  scope.self = scope;
  vm.createContext(scope);

  for (const file of [
    'protobuf-d2ff6ec9a3.js',
    'protobuf-bundles-1f16c1f251.js'
  ]) {
    const filename = path.resolve(__dirname, '../libs', file);
    vm.runInContext(
      fs.readFileSync(filename, 'utf8'),
      scope,
      { filename: file }
    );
  }

  proto = scope.com.road.yishi.proto;
  return proto;
}

function type(name) {
  return name.split('.').reduce((obj, key) => obj[key], load());
}

function encode(name, data) {
  const T = type(name);
  return Buffer.from(T.encode(new T(data)).finish());
}

function decode(name, bytes) {
  return type(name).decode(Uint8Array.from(bytes));
}

module.exports = { load, type, encode, decode };
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('quantity controls emit only allowed changes and respect inventory and busy states', () => {
  const source = readFileSync(
    new URL('../../../apps/mobile/components/QuantityStepper.uvue', import.meta.url),
    'utf8',
  ).match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const props = { value: 1, max: 3, disabled: false },
    events = [],
    exports = {};
  const compiled = ts.transpileModule(source + '\nexports.change=change;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: () => ({}),
    defineProps: () => props,
    withDefaults: (value, defaults) => {
      for (const [key, item] of Object.entries(defaults))
        if (value[key] === undefined) value[key] = item;
      return value;
    },
    defineEmits:
      () =>
      (...args) =>
        events.push(args),
    computed: (read) => ({
      get value() {
        return read();
      },
    }),
  });
  exports.change(-1);
  assert.equal(events.length, 0);
  exports.change(1);
  assert.deepEqual(events.pop(), ['change', 1]);
  props.value = 3;
  exports.change(1);
  assert.equal(events.length, 0);
  exports.change(-1);
  assert.deepEqual(events.pop(), ['change', -1]);
  props.disabled = true;
  exports.change(-1);
  exports.change(1);
  assert.equal(events.length, 0);
  props.disabled = false;
  props.min = 0;
  props.value = 1;
  exports.change(-1);
  assert.deepEqual(events.pop(), ['change', -1]);
  props.value = 0;
  exports.change(-1);
  assert.equal(events.length, 0);
  props.value = 3;
  props.max = 0;
  exports.change(1);
  assert.equal(events.length, 0);
});

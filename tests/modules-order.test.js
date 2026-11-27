// The student's own module order (src/modorder.js): applying a saved order, moving modules.
// Usage: node tests/modules-order.test.js
const assert = require('assert');
const path = require('path');
const ext = process.argv[2] || path.join(__dirname, '..', 'extension');
const { applyModuleOrder, moveModule, placeOf } = require(path.join(ext, 'src', 'modorder.js'));

// Brightspace's order: Pinned, Course Home, Week 1 (with two sub-modules, one with its own), Week 2, Week 3.
const mod = (id, depth = 0) => ({ id, depth, name: `M${id}`, items: [] });
const list = [mod('pinned'), mod('home'), mod(1), mod(11, 1), mod(111, 2), mod(12, 1), mod(2), mod(3)];
const ids = (l) => l.map((m) => m.id);

// No saved order: exactly Brightspace's (the same array).
assert.strictEqual(applyModuleOrder(list, undefined), list);
assert.strictEqual(applyModuleOrder(list, []), list);
assert.strictEqual(applyModuleOrder(list, 'junk'), list);

// A full saved order; Pinned stays first, sub-modules travel with their parent.
assert.deepStrictEqual(ids(applyModuleOrder(list, [3, 1, 12, 11, 111, 'home', 2])), ['pinned', 3, 1, 12, 11, 111, 'home', 2]);
// The same objects come back, and depths are untouched.
const shown = applyModuleOrder(list, [3, 1, 12, 11, 111, 'home', 2]);
assert.strictEqual(shown[1], list[7]);
assert.deepStrictEqual(shown.map((m) => m.depth), [0, 0, 0, 1, 1, 2, 0, 0]);
// Saving 'pinned' in the order changes nothing about it (Week 3, unknown, follows Week 2).
assert.deepStrictEqual(ids(applyModuleOrder(list, [2, 'pinned', 1])), ['pinned', 'home', 2, 3, 1, 11, 111, 12]);

// Gone ids are ignored; numbers and their text match (ids saved as text still work).
assert.deepStrictEqual(ids(applyModuleOrder(list, [99, '3', 'home', 1, 2, 77])), ['pinned', 3, 'home', 1, 11, 111, 12, 2]);

// Unknown (new) modules stay right after the module they follow in Brightspace; first if first.
// Saved before Week 4 (id 4, after 3) and New first (id 0, before home) existed.
const later = [mod(0), mod('home'), mod(1), mod(11, 1), mod(13, 1), mod(12, 1), mod(2), mod(3), mod(4)];
assert.deepStrictEqual(ids(applyModuleOrder(later, [3, 2, 1, 12, 11, 'home'])), [0, 3, 4, 2, 1, 12, 11, 13, 'home']);
// Partial orders: each unknown module rides with the known one before it.
assert.deepStrictEqual(ids(applyModuleOrder(later, [2])), [0, 'home', 1, 11, 13, 12, 2, 3, 4]);
assert.deepStrictEqual(ids(applyModuleOrder(later, [3, 'home'])), [0, 3, 4, 'home', 1, 11, 13, 12, 2]);
// Applying again gives the same (the shown list can stand in for Brightspace's).
const once = applyModuleOrder(later, [3, 2, 1, 12, 11, 'home']);
assert.deepStrictEqual(ids(applyModuleOrder(once, [3, 2, 1, 12, 11, 'home'])), ids(once));

// Moving: top-level among top-level; Pinned never passes.
assert.deepStrictEqual(moveModule(list, [], 'home', 'up'), null);
assert.deepStrictEqual(moveModule(list, [], 'home', 'top'), null);
assert.deepStrictEqual(moveModule(list, [], 'home', 'down'), [1, 11, 111, 12, 'home', 2, 3]);
assert.deepStrictEqual(moveModule(list, [], 3, 'top'), [3, 'home', 1, 11, 111, 12, 2]);
assert.deepStrictEqual(moveModule(list, [], 3, 'down'), null);
assert.deepStrictEqual(moveModule(list, [], 3, 'bottom'), null);
assert.deepStrictEqual(moveModule(list, [], 1, 'bottom'), ['home', 2, 3, 1, 11, 111, 12]);
assert.deepStrictEqual(moveModule(list, [], 'pinned', 'down'), null);
assert.deepStrictEqual(moveModule(list, [], 42, 'down'), null);
assert.deepStrictEqual(moveModule(list, [], 2, 'sideways'), null);
// Sub-modules move within their parent only, with their own sub-modules.
assert.deepStrictEqual(moveModule(list, [], 12, 'up'), ['home', 1, 12, 11, 111, 2, 3]);
assert.deepStrictEqual(moveModule(list, [], 12, 'down'), null);
assert.deepStrictEqual(moveModule(list, [], 111, 'up'), null);
// Moves start from the saved order; back to Brightspace's own order gives [] (nothing to keep).
const saved = moveModule(list, [], 3, 'up');
assert.deepStrictEqual(saved, ['home', 1, 11, 111, 12, 3, 2]);
assert.deepStrictEqual(moveModule(list, saved, 3, 'down'), []);
assert.deepStrictEqual(moveModule(list, saved, 2, 'up'), []);
// Without Pinned in the list, the first module can still not go up.
assert.deepStrictEqual(moveModule(list.slice(1), [], 'home', 'up'), null);
assert.deepStrictEqual(moveModule(list.slice(1), [], 2, 'top'), [2, 'home', 1, 11, 111, 12, 3]);
// A saved order with gone ids drops them on the next move.
assert.deepStrictEqual(moveModule(list, [99, 3, 'home', 1, 2], 2, 'up'), [3, 'home', 2, 1, 11, 111, 12]);

// Place among movable siblings (for which Move items to show).
assert.deepStrictEqual(placeOf(list, 'home'), { at: 0, of: 4 });
assert.deepStrictEqual(placeOf(list, 3), { at: 3, of: 4 });
assert.deepStrictEqual(placeOf(list, 12), { at: 1, of: 2 });
assert.deepStrictEqual(placeOf(list, 111), { at: 0, of: 1 });
assert.strictEqual(placeOf(list, 'pinned'), null);
assert.strictEqual(placeOf(list, 42), null);

console.log('modules-order: all passed');

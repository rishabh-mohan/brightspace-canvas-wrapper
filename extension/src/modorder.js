// The student's own order for a course's modules (the Modules page and course Home), kept in
// settings.moduleOrder[courseId] as a list of module ids. Brightspace's order is the default.
// `list` is a course's flat module list, [{ id, depth }] with each module's sub-modules right
// after it (one deeper), as data.modules gives it. Modules move among their siblings only, with
// everything under them. "Pinned" stays first and never moves.
// A module the saved order does not know (added since) stays right after the module it follows
// in Brightspace (first, if it is first there); saved ids that are gone are ignored.
// Plain functions, so tests can run them without a browser (tests/modules-order.test.js).
(function (root) {
  const FIXED = 'pinned';

  // The flat list as a tree: [{ m, kids }].
  function tree(list) {
    const roots = [];
    const stack = [];
    for (const m of list) {
      const node = { m, kids: [] };
      while (stack.length && stack[stack.length - 1].m.depth >= m.depth) stack.pop();
      (stack.length ? stack[stack.length - 1].kids : roots).push(node);
      stack.push(node);
    }
    return roots;
  }
  const flatten = (nodes) => nodes.flatMap((n) => [n.m, ...flatten(n.kids)]);
  const rankOf = (order) => {
    const rank = new Map();
    (Array.isArray(order) ? order : []).forEach((id, at) => rank.has(String(id)) || rank.set(String(id), at));
    return rank;
  };

  // Each module the order knows leads a run: itself and the unknown modules after it in
  // Brightspace's order. Unknown modules before any known one stay first.
  function arrange(nodes, rank) {
    const fixed = nodes.filter((n) => n.m.id === FIXED);
    const head = [];
    const runs = [];
    for (const n of nodes) {
      if (n.m.id === FIXED) continue;
      if (rank.has(String(n.m.id))) runs.push([n]);
      else (runs.length ? runs[runs.length - 1] : head).push(n);
    }
    runs.sort((a, b) => rank.get(String(a[0].m.id)) - rank.get(String(b[0].m.id)));
    return [...fixed, ...head, ...runs.flat()].map((n) => ({ m: n.m, kids: arrange(n.kids, rank) }));
  }

  // The list in the saved order (the same objects). No saved order: the list itself.
  function applyModuleOrder(list, order) {
    if (!Array.isArray(order) || !order.length) return list;
    return flatten(arrange(tree(list), rankOf(order)));
  }

  // The sibling list holding module `id`, or null.
  function siblingsOf(nodes, id) {
    for (const n of nodes) if (String(n.m.id) === String(id)) return nodes;
    for (const n of nodes) {
      const found = siblingsOf(n.kids, id);
      if (found) return found;
    }
    return null;
  }

  // Where module `id` sits among the siblings it can trade places with, in `list` as shown:
  // { at, of }, or null for Pinned and unknown ids.
  function placeOf(list, id) {
    if (id === FIXED) return null;
    const sibs = siblingsOf(tree(list), id);
    if (!sibs) return null;
    const movable = sibs.filter((n) => n.m.id !== FIXED);
    return { at: movable.findIndex((n) => String(n.m.id) === String(id)), of: movable.length };
  }

  // The order after moving module `id` ('up', 'down', 'top' or 'bottom'), as the ids of every
  // module (Pinned left out). [] when that is Brightspace's own order (nothing to keep), null
  // when the module cannot move that way.
  function moveModule(list, order, id, where) {
    const roots = arrange(tree(list), rankOf(order));
    const sibs = id === FIXED ? null : siblingsOf(roots, id);
    if (!sibs) return null;
    const from = sibs.findIndex((n) => String(n.m.id) === String(id));
    const first = sibs.filter((n) => n.m.id === FIXED).length;
    const to = { up: from - 1, down: from + 1, top: first, bottom: sibs.length - 1 }[where];
    if (to == null || to < first || to >= sibs.length || to === from) return null;
    sibs.splice(to, 0, ...sibs.splice(from, 1));
    const ids = flatten(roots).filter((m) => m.id !== FIXED).map((m) => m.id);
    const own = list.filter((m) => m.id !== FIXED).map((m) => m.id);
    return ids.every((x, at) => x === own[at]) ? [] : ids;
  }

  const api = { applyModuleOrder, moveModule, placeOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BSX = root.BSX || {}).modorder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

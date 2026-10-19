// A tiny DOM for running the browser visual audit's page probe in Node. It
// implements only what scripts/visualAudit/pageProbe.mjs calls: a selector
// subset, SVG transforms as translate/scale, text boxes and baselines given in
// user space, sampled path geometry, computed opacity/visibility/fonts, and
// manually driven animation frames with ResizeObserver delivery after them.

const parseTransform = value => {
  const translate = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(value || '');
  const scale = /scale\(\s*(-?[\d.]+)\s*\)/.exec(value || '');
  return { k: scale ? Number(scale[1]) : 1, x: translate ? Number(translate[1]) : 0, y: translate ? Number(translate[2]) : 0 };
};
const compose = (outer, inner) => ({ a: outer.a * inner.k, b: 0, c: 0, d: outer.d * inner.k,
  e: outer.e + outer.a * inner.x, f: outer.f + outer.d * inner.y });
const apply = (m, [x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

function splitTop(selector, separator) {
  const parts = [];
  let depth = 0, quote = null, current = '';
  for (const char of selector) {
    if (quote) { if (char === quote) quote = null; current += char; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if (char === '[') depth++;
    if (char === ']') depth--;
    if (!depth && separator.test(char)) { parts.push(current); current = ''; continue; }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Compounds alternate with combinators: '>' for a child, ' ' for a descendant. */
function parseComplex(selector) {
  const parts = [];
  for (const piece of splitTop(selector.trim().replace(/\s*>\s*/g, ' > '), /\s/)) {
    if (!piece) continue;
    if (piece === '>') { parts.push('>'); continue; }
    if (parts.length && parts.at(-1) !== '>') parts.push(' ');
    parts.push(parseCompound(piece));
  }
  return parts;
}

function parseCompound(token) {
  const compound = { tag: null, classes: [], attrs: [], scope: false };
  const pattern = /(:scope)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|(\*|[A-Za-z][\w-]*)/g;
  let match;
  while ((match = pattern.exec(token))) {
    if (match[1]) compound.scope = true;
    else if (match[2]) compound.classes.push(match[2]);
    else if (match[3]) compound.attrs.push([match[3], match[4]]);
    else if (match[5] && match[5] !== '*') compound.tag = match[5];
  }
  return compound;
}

const compoundMatches = (element, compound, scope) => (!compound.scope || element === scope)
  && (!compound.tag || element.tagName.toLowerCase() === compound.tag.toLowerCase())
  && compound.classes.every(name => element.classList.includes(name))
  && compound.attrs.every(([name, value]) => element.hasAttribute(name) && (value === undefined || element.getAttribute(name) === value));

function complexMatches(element, parts, scope) {
  const last = parts.length - 1;
  if (!compoundMatches(element, parts[last], scope)) return false;
  if (!last) return true;
  const combinator = parts[last - 1], rest = parts.slice(0, last - 1);
  if (combinator === '>') return Boolean(element.parentElement) && complexMatches(element.parentElement, rest, scope);
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (complexMatches(ancestor, rest, scope)) return true;
  }
  return false;
}

const matchesSelector = (element, selector, scope) => splitTop(selector, /,/).some(part => {
  const parts = parseComplex(part);
  if (parts[0] === '>') parts.unshift({ tag: null, classes: [], attrs: [], scope: true });
  return complexMatches(element, parts, scope);
});

export function createAuditDom({ width = 1440, height = 900 } = {}) {
  const frames = [], observers = new Set();
  let now = 1000, rafId = 0;
  class FakeText { constructor(text) { this.nodeType = 3; this.textContent = text; this.parentElement = null; } }
  class FakeElement {
    constructor(tag, attrs = {}) {
      this.tagName = tag; this.nodeType = 1; this.attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
      this.childNodes = []; this.parentElement = null; this.styleProps = {}; this.computed = {};
      this.style = new Proxy(this.styleProps, { set: (target, key, value) => { target[key] = value; return true; } });
    }
    get classList() { return (this.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
    get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) { this.childNodes = [new FakeText(String(value))]; }
    get id() { return this.getAttribute('id'); }
    set id(value) { this.setAttribute('id', value); }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    hasAttribute(name) { return this.attrs.has(name); }
    append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? new FakeText(node) : node); return this; }
    appendChild(node) { node.parentElement?.childNodes.splice(node.parentElement.childNodes.indexOf(node), 1); node.parentElement = this; this.childNodes.push(node); return node; }
    remove() { if (this.parentElement) { this.parentElement.childNodes.splice(this.parentElement.childNodes.indexOf(this), 1); this.parentElement = null; } }
    contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector) { return this.descendants().filter(element => matchesSelector(element, selector, this)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    matches(selector) { return matchesSelector(this, selector, null); }
    closest(selector) { for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current; return null; }
    getScreenCTM() {
      if (this.tagName === 'svg') { const box = this.box; return { a: 1, b: 0, c: 0, d: 1, e: box.x, f: box.y }; }
      const parent = this.parentElement?.getScreenCTM?.();
      return parent ? compose(parent, parseTransform(this.getAttribute('transform'))) : null;
    }
    getBoundingClientRect() {
      if (this.box) return { ...this.box, left: this.box.x, top: this.box.y, right: this.box.x + this.box.width, bottom: this.box.y + this.box.height };
      const m = this.getScreenCTM?.();
      let local = this.localBox;
      if (this.points && m) local = (() => { const xs = this.points.map(p => p[0]), ys = this.points.map(p => p[1]);
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }; })();
      if (local && m) {
        const [x, y] = apply(m, [local.x, local.y]);
        const box = { x, y, width: local.width * m.a, height: local.height * m.d };
        return { ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
      }
      const boxes = this.children.map(child => child.getBoundingClientRect()).filter(box => box.width || box.height);
      if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
      const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
      const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
      return { x, y, width: right - x, height: bottom - y, left: x, top: y, right, bottom };
    }
    getClientRects() { const box = this.getBoundingClientRect(); return box.width || box.height ? [box] : []; }
    getTotalLength() { let length = 0; for (let i = 1; i < this.points.length; i++) length += Math.hypot(this.points[i][0] - this.points[i - 1][0], this.points[i][1] - this.points[i - 1][1]); return length; }
    getPointAtLength(distance) {
      let left = distance;
      for (let i = 1; i < this.points.length; i++) {
        const [ax, ay] = this.points[i - 1], [bx, by] = this.points[i], segment = Math.hypot(bx - ax, by - ay);
        if (left <= segment || i === this.points.length - 1) { const t = segment ? Math.min(1, left / segment) : 0; return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t }; }
        left -= segment;
      }
      return { x: this.points[0][0], y: this.points[0][1] };
    }
    getNumberOfChars() { return this.textContent.length; }
    getStartPositionOfChar() { return { x: this.localBox?.x ?? 0, y: this.baseline ?? (this.localBox ? this.localBox.y + this.localBox.height * 0.8 : 0) }; }
    click() { if (!this.disabled) this.onclick?.(); }
    addEventListener(type, listener) { (this.listeners ??= {})[type] = [...(this.listeners[type] || []), listener]; }
    dispatchEvent(event) { (this.listeners?.[event.type] || []).forEach(listener => listener(event)); return true; }
    getContext() { return { font: '', measureText(text) { const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] || '10');
      return { width: text.length * size * 0.6, actualBoundingBoxAscent: size * 0.7, actualBoundingBoxDescent: size * 0.1 }; } }; }
  }
  class FakeInput extends FakeElement {
    get value() { return this.getAttribute('value'); }
    set value(value) { this.setAttribute('value', value); }
    get max() { return this.getAttribute('max'); }
  }
  const element = (tag, attrs = {}, ...children) => {
    const node = tag === 'input' ? new FakeInput(tag, attrs) : new FakeElement(tag, attrs);
    node.append(...children);
    return node;
  };
  const documentElement = element('html', {}, element('body'));
  const computedStyle = node => {
    const inherited = name => { for (let current = node; current; current = current.parentElement) if (current.computed[name] !== undefined) return current.computed[name]; return undefined; };
    return {
      opacity: String(node.computed.opacity ?? node.getAttribute('opacity') ?? 1), display: node.computed.display ?? 'inline',
      visibility: inherited('visibility') ?? 'visible', fontSize: inherited('fontSize') ?? '16px', fontStyle: 'normal', fontWeight: '900',
      fontFamily: 'Quicksand', backgroundColor: node.computed.backgroundColor ?? 'rgba(0, 0, 0, 0)',
      stroke: node.computed.stroke ?? (node.getAttribute('stroke') || (['path', 'line', 'polyline'].includes(node.tagName) ? 'rgb(52, 211, 153)' : 'none')),
      strokeOpacity: '1', strokeWidth: String(node.getAttribute('stroke-width') ?? 2), vectorEffect: node.computed.vectorEffect ?? 'none',
      paintOrder: node.computed.paintOrder ?? 'normal'
    };
  };
  const document = {
    documentElement, body: documentElement.children[0],
    querySelector: selector => documentElement.querySelector(selector),
    querySelectorAll: selector => documentElement.querySelectorAll(selector),
    getElementById: id => documentElement.descendants().find(node => node.getAttribute('id') === id) ?? null,
    createElement: tag => element(tag)
  };
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Map(); }
    observe(target) { this.targets.set(target, null); observers.add(this); }
    disconnect() { observers.delete(this); this.targets.clear(); }
  }
  const window = { innerWidth: width, innerHeight: height };
  const globals = { window, document, getComputedStyle: computedStyle, ResizeObserver: FakeResizeObserver,
    HTMLInputElement: FakeInput,
    requestAnimationFrame: callback => { frames.push({ id: ++rafId, callback }); return rafId; },
    cancelAnimationFrame: id => { const index = frames.findIndex(frame => frame.id === id); if (index >= 0) frames.splice(index, 1); },
    performance: { now: () => now } };
  return {
    element, document, window, globals,
    /** One rendering update: animation callbacks, then ResizeObserver delivery. */
    renderFrame(ms = 1000 / 60) {
      now += ms;
      for (const frame of frames.splice(0)) frame.callback(now);
      for (const observer of [...observers]) {
        const changed = [...observer.targets].filter(([target, last]) => last !== (target.styleProps.width ?? ''));
        changed.forEach(([target]) => observer.targets.set(target, target.styleProps.width ?? ''));
        if (changed.length) observer.callback(changed.map(([target]) => ({ target })));
      }
    },
    install() {
      const previous = Object.fromEntries(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
      for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
      return () => { for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; };
    }
  };
}

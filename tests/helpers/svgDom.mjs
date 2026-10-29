import { select } from 'd3';

export { select };
export const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
// Attribute presence ([name]) is supported; valued attribute selectors never match.
export const matches = (node, selector) => selector.split(',').some(part => {
  const attributes = [...part.matchAll(/\[([\w-]+)\]/g)].map(match => match[1]);
  const [tag, ...classes] = part.replace(/\[[\w-]+\]/g, '').trim().split('.');
  return (!tag || tag === '*' || tag === node.tag)
    && classes.every(name => node.classList.contains(name))
    && attributes.every(name => Object.hasOwn(node.attrs, name));
});

// A 2-D affine screen matrix with the DOMMatrix operations the renderer uses.
export class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) { Object.assign(this, { a, b, c, d, e, f }); }
  multiply(m) {
    return new Matrix(this.a * m.a + this.c * m.b, this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d, this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e, this.b * m.e + this.d * m.f + this.f);
  }
  translate(x, y = 0) { return this.multiply(new Matrix(1, 0, 0, 1, x, y)); }
  scale(x, y = x) { return this.multiply(new Matrix(x, 0, 0, y, 0, 0)); }
  inverse() {
    const det = this.a * this.d - this.b * this.c;
    return new Matrix(this.d / det, -this.b / det, -this.c / det, this.a / det,
      (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det);
  }
}

// A deterministic SVG DOM for running the real D3 painters. Native browser
// captures remain responsible for font rasterization and camera animation.
export function createSvgDom(measureText = (text, style) => ({
  width: [...text].length * (style.fontSize * 0.6 + style.letterSpacing),
  ascent: style.fontSize * 0.8, descent: style.fontSize * 0.2
})) {
  class Element {
    constructor(tag, attrs = {}, datum) {
      this.tag = tag;
      this.attrs = { ...attrs };
      this.styles = {};
      this.children = [];
      this.text = '';
      this.__data__ = datum;
      this.ownerDocument = document;
      this.namespaceURI = 'http://www.w3.org/2000/svg';
      this.rect = { left: 0, top: 0, right: 50, bottom: 30, width: 50, height: 30 };
      this.style = {
        setProperty: (name, value) => { this.styles[name] = String(value); },
        removeProperty: name => { delete this.styles[name]; },
        getPropertyValue: name => this.styles[name] ?? ''
      };
    }
    get tagName() { return this.tag; }
    get datum() { return this.__data__; }
    set datum(value) { this.__data__ = value; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
    get parentElement() { return this.parentNode; }
    get parent() { return this.parentNode; }
    get firstChild() { return this.children[0] ?? null; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null; }
    get classList() {
      const write = (name, enabled) => {
        const classes = new Set((this.attrs.class || '').split(' ').filter(Boolean));
        enabled ? classes.add(name) : classes.delete(name);
        this.attrs.class = [...classes].join(' ');
      };
      return {
        contains: name => (this.attrs.class || '').split(' ').includes(name),
        add: name => write(name, true), remove: name => write(name, false), toggle: write
      };
    }
    get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
    get dataset() { return Object.fromEntries(Object.entries(this.attrs)
      .filter(([name]) => name.startsWith('data-'))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value])); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    setAttributeNS(namespace, name, value) { this.setAttribute(namespace === 'http://www.w3.org/XML/1998/namespace' ? `xml:${name}` : name, value); }
    getAttributeNS(namespace, name) { return this.getAttribute(namespace === 'http://www.w3.org/XML/1998/namespace' ? `xml:${name}` : name); }
    removeAttributeNS(namespace, name) { this.removeAttribute(namespace === 'http://www.w3.org/XML/1998/namespace' ? `xml:${name}` : name); }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    appendChild(child) { child.parentNode?.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
    insertBefore(child, before) {
      child.parentNode = this;
      const index = this.children.indexOf(before);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      return child;
    }
    removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; }
    cloneNode() { return new Element(this.tag, this.attrs, this.datum); }
    querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    matches(selector) { return matches(this, selector); }
    compareDocumentPosition(other) {
      if (this === other) return 0;
      if (!this.parentNode || this.parentNode !== other.parentNode) return 1;
      return this.parentNode.children.indexOf(this) < this.parentNode.children.indexOf(other) ? 4 : 2;
    }
    closest(selector) { return matches(this, selector) ? this : this.parentNode?.closest(selector) ?? null; }
    addEventListener(name, listener) { (this.handlers ??= {})[name] = listener; }
    removeEventListener(name) { delete this.handlers?.[name]; }
    getBoundingClientRect() { return this.rect; }
    getScreenCTM() { return new Matrix(); }
    metrics() { return measureText(this.textContent, {
      fontSize: parseFloat(this.styles['font-size'] || 28),
      letterSpacing: parseFloat(this.styles['letter-spacing'] || 0)
    }); }
    getBBox() { const { width, ascent, descent } = this.metrics(); return { x: 0, y: -ascent, width, height: ascent + descent }; }
    getComputedTextLength() { return this.metrics().width; }
    getTotalLength() { return 100; }
    getPointAtLength(length) {
      const points = this.attrs.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
      const t = length / 100, u = 1 - t;
      return { x: u ** 3 * points[0] + 3 * u ** 2 * t * points[2] + 3 * u * t ** 2 * points[4] + t ** 3 * points[6],
        y: u ** 3 * points[1] + 3 * u ** 2 * t * points[3] + 3 * u * t ** 2 * points[5] + t ** 3 * points[7] };
    }
  }
  const document = { createElementNS: (_namespace, tag) => new Element(tag) };
  document.documentElement = new Element('svg');
  const globals = {
    document, SVGElement: Element,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    DOMPoint: class {
      constructor(x, y) { this.x = x; this.y = y; }
      matrixTransform(matrix) {
        return new globals.DOMPoint(this.x * (matrix.a ?? matrix.scale ?? 1) + this.y * (matrix.c ?? 0) + (matrix.e ?? 0),
          this.x * (matrix.b ?? 0) + this.y * (matrix.d ?? matrix.scale ?? 1) + (matrix.f ?? 0));
      }
    }
  };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);
  const restore = () => saved.forEach((descriptor, key) => descriptor
    ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  return { Element, document, restore };
}

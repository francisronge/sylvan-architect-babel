// The smallest DOM React's real client renderer needs, so an offline test can
// exercise behavior that only exists on the client (error boundaries, effects).
// It has no layout, CSS, focus or native events: tests call the React handler
// on an element directly with `invoke`.

class MinimalNode {
  constructor(nodeType, nodeName, ownerDocument) {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  appendChild(child) {
    child.parentNode?.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child, reference) {
    if (!reference) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    this.childNodes.splice(this.childNodes.indexOf(reference), 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  addEventListener() {}
  removeEventListener() {}
  get textContent() {
    return this.nodeType === 3 || this.nodeType === 8 ? this.data : this.childNodes.map(node => node.textContent).join('');
  }
  set textContent(value) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
}

class MinimalElement extends MinimalNode {
  constructor(tagName, ownerDocument) {
    super(1, tagName.toUpperCase(), ownerDocument);
    this.tagName = this.nodeName;
    this.attributes = new Map();
    const style = {};
    Object.defineProperties(style, {
      setProperty: { value: (name, value) => { style[name] = value; } },
      removeProperty: { value: name => { delete style[name]; } }
    });
    this.style = style;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  /** React's <select> sets `selected` on these. */
  get options() {
    return this.tagName === 'SELECT' ? allElements(this).filter(element => element.tagName === 'OPTION') : undefined;
  }
  focus() {}
  blur() {}
}

class MinimalText extends MinimalNode {
  constructor(data, ownerDocument) { super(3, '#text', ownerDocument); this.data = data; }
  get nodeValue() { return this.data; }
  set nodeValue(value) { this.data = value; }
}

class MinimalDocument extends MinimalNode {
  constructor() {
    super(9, '#document', null);
    this.ownerDocument = this;
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }
  createElement(tagName) { return new MinimalElement(tagName, this); }
  createElementNS(_namespace, tagName) { return new MinimalElement(tagName, this); }
  createTextNode(data) { return new MinimalText(data, this); }
  createComment(data) { const node = new MinimalNode(8, '#comment', this); node.data = data; return node; }
}

/** Installs the DOM globals and returns a mounted container. Call once per test process. */
export function installMinimalDom({ search = '' } = {}) {
  const document = new MinimalDocument();
  Object.assign(globalThis, {
    document,
    window: globalThis,
    HTMLElement: MinimalElement,
    HTMLIFrameElement: class {},
    IS_REACT_ACT_ENVIRONMENT: true,
    location: { search, href: `http://localhost/${search}` },
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    scrollTo: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    innerHeight: 900,
    innerWidth: 1440
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

export const allElements = (root) => {
  const found = [];
  const visit = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 1) { found.push(child); visit(child); }
    }
  };
  visit(root);
  return found;
};

export const findElement = (root, predicate) => allElements(root).find(predicate) ?? null;

export const findButton = (root, text) =>
  findElement(root, element => element.tagName === 'BUTTON' && element.textContent.includes(text));

/** Calls the React handler a native event would reach, e.g. invoke(button, 'onClick'). */
export function invoke(element, handler, event = {}) {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  const callback = propsKey && element[propsKey][handler];
  if (typeof callback !== 'function') throw new Error(`${element.tagName} has no ${handler}`);
  return callback({ preventDefault() {}, stopPropagation() {}, target: element, currentTarget: element, nativeEvent: {}, ...event });
}

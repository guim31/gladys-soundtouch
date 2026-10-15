// -----------------------------------------------------------------------------
// A small XML reader for the SoundTouch API.
//
// The speakers answer in plain, flat XML (no namespace, no DTD): elements,
// attributes, text and the five predefined entities. A full parser would be a
// dependency for nothing; this one builds a tree of `{ name, attributes,
// children, text }` nodes and tolerates what the speakers send (an XML
// declaration, comments, CDATA, single or double quotes, self-closing tags).
// Malformed input throws: a truncated answer must not look like an empty one.
// -----------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Replace the predefined and numeric entities. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[entity] ?? whole;
  });
}

/** Escape a text for an element body or an attribute value. */
export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const ATTRIBUTE = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/**
 * Parse an XML document into its root element.
 * @param {string} source
 * @returns {{ name: string, attributes: Record<string, string>, children: object[], text: string }}
 */
export function parseXml(source) {
  if (typeof source !== 'string') {
    throw new Error('XML: not a string');
  }
  const root = { name: '#document', attributes: {}, children: [], text: '' };
  const stack = [root];
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf('<', at);
    const top = stack[stack.length - 1];
    if (open === -1) {
      top.text += decodeEntities(source.slice(at));
      break;
    }
    if (open > at) {
      top.text += decodeEntities(source.slice(at, open));
    }
    if (source.startsWith('<?', open)) {
      at = skipPast(source, '?>', open);
    } else if (source.startsWith('<!--', open)) {
      at = skipPast(source, '-->', open);
    } else if (source.startsWith('<![CDATA[', open)) {
      const end = source.indexOf(']]>', open);
      if (end === -1) {
        throw new Error('XML: unterminated CDATA');
      }
      top.text += source.slice(open + 9, end);
      at = end + 3;
    } else if (source.startsWith('<!', open)) {
      at = skipPast(source, '>', open);
    } else if (source[open + 1] === '/') {
      NAME.lastIndex = open + 2;
      const match = NAME.exec(source);
      const close = source.indexOf('>', open);
      if (!match || close === -1) {
        throw new Error(`XML: invalid closing tag at ${open}`);
      }
      if (stack.length < 2 || top.name !== match[0]) {
        throw new Error(`XML: unexpected </${match[0]}>`);
      }
      stack.pop();
      at = close + 1;
    } else {
      at = readElement(source, open, stack);
    }
  }
  if (stack.length !== 1) {
    throw new Error(`XML: <${stack[stack.length - 1].name}> is not closed`);
  }
  const element = root.children[0];
  if (!element) {
    throw new Error('XML: no element');
  }
  return element;
}

function skipPast(source, marker, from) {
  const end = source.indexOf(marker, from);
  if (end === -1) {
    throw new Error(`XML: unterminated markup at ${from}`);
  }
  return end + marker.length;
}

function readElement(source, open, stack) {
  NAME.lastIndex = open + 1;
  const match = NAME.exec(source);
  if (!match) {
    throw new Error(`XML: invalid tag at ${open}`);
  }
  const element = { name: match[0], attributes: {}, children: [], text: '' };
  let at = NAME.lastIndex;
  for (;;) {
    ATTRIBUTE.lastIndex = at;
    const attribute = ATTRIBUTE.exec(source);
    if (!attribute) {
      break;
    }
    element.attributes[attribute[1]] = decodeEntities(attribute[3] ?? attribute[4]);
    at = ATTRIBUTE.lastIndex;
  }
  while (/\s/.test(source[at] ?? '')) {
    at += 1;
  }
  stack[stack.length - 1].children.push(element);
  if (source.startsWith('/>', at)) {
    return at + 2;
  }
  if (source[at] !== '>') {
    throw new Error(`XML: invalid <${element.name}> tag`);
  }
  stack.push(element);
  return at + 1;
}

/** First child element named `name`, or null. */
export function child(node, name) {
  return node?.children.find((item) => item.name === name) ?? null;
}

/** Every child element named `name`. */
export function children(node, name) {
  return node ? node.children.filter((item) => item.name === name) : [];
}

/** Trimmed text of the first child named `name`, or null when absent or empty. */
export function childText(node, name) {
  const text = child(node, name)?.text.trim();
  return text ? text : null;
}

/** Serialize an element back to XML (used to send a preset's ContentItem back). */
export function toXml(node) {
  const attributes = Object.entries(node.attributes)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
  const inner = node.children.map(toXml).join('') + escapeXml(node.text.trim());
  return `<${node.name}${attributes}>${inner}</${node.name}>`;
}

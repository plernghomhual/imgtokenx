/**
 * Regression guard for audit finding D8 (prototype pollution via untrusted
 * schema property names). `stripSchemaDescriptions` must preserve a property
 * literally named `__proto__` as an OWN property and must NOT let it reassign
 * the clone's prototype (which would weaken/corrupt the tool contract).
 */

import { describe, expect, it } from 'vitest';
import { stripSchemaDescriptions } from '../src/core/schema-strip.js';

describe('schema-strip prototype safety (D8)', () => {
  // A tool schema arrives as JSON; JSON.parse creates a REAL own `__proto__`
  // key (unlike an object literal, which would set the prototype). This is
  // the genuine untrusted-input vector.
  const parse = (s: string) => JSON.parse(s) as Record<string, unknown>;

  it('keeps a property named __proto__ as an own property, not a prototype change', () => {
    const schema = parse(
      '{"type":"object","properties":{"__proto__":{"type":"string"},"name":{"type":"string"}}}',
    );
    const out = stripSchemaDescriptions(schema) as Record<string, unknown>;
    const props = out.properties as Record<string, unknown>;

    // The polluted case (pre-fix): properties.__proto__ would become the
    // subtree's PROTOTYPE, so the value we set would vanish.
    expect(Object.prototype.hasOwnProperty.call(props, '__proto__')).toBe(true);
    expect((props['__proto__'] as Record<string, unknown>).type).toBe('string');
    expect(props.name).toBeDefined();
    // Clone must be a null-prototype object — no prototype reassignment.
    expect(Object.getPrototypeOf(out)).toBeNull();
  });

  it('does not pollute the clone prototype or Object.prototype', () => {
    const schema = parse(
      '{"properties":{"__proto__":{"type":"object","properties":{"inner":{"type":"string"}}},"sibling":{"type":"number"}}}',
    );
    const out = stripSchemaDescriptions(schema) as Record<string, unknown>;
    // Null-prototype: the cloned `properties` subtree is isolated.
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect((out.properties as Record<string, unknown>).sibling).toBeDefined();
    const inner = (out.properties as Record<string, unknown>).__proto__ as Record<string, unknown>;
    expect(inner.type).toBe('object');
    // The global Object.prototype is untouched.
    expect(Object.prototype.hasOwnProperty.call({}, 'polluted')).toBe(false);
  });

  it('still recurses normally for legitimate deep schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { description: 'drop me', type: 'string' },
        b: { title: 'also drop', properties: { c: { type: 'number' } } },
      },
    };
    const out = stripSchemaDescriptions(schema) as Record<string, unknown>;
    const props = out.properties as Record<string, unknown>;
    expect(props.a).toBeDefined();
    expect((props.a as Record<string, unknown>).description).toBeUndefined();
    expect((props.b as Record<string, unknown>).title).toBeUndefined();
    const bProps = (props.b as Record<string, unknown>).properties as Record<string, unknown>;
    expect((bProps.c as Record<string, unknown>).type).toBe('number');
  });
});

import { describe, it, expect } from 'vitest';
import {
  redactErrorBody,
  REDACT_INPUT_MAX,
  redactionPatterns,
  type RedactionKind,
} from '../src/core/redact.js';

describe('redactErrorBody', () => {
  describe('email', () => {
    it('redacts standard email addresses', () => {
      expect(redactErrorBody('user@example.com')).toBe('[REDACTED:email]');
      expect(redactErrorBody('first.last+tag@sub.example.co.uk')).toBe('[REDACTED:email]');
    });
    it('redacts emails inline in prose', () => {
      expect(redactErrorBody('contact alice@example.org for details'))
        .toBe('contact [REDACTED:email] for details');
    });
    it('does not redact domains without @', () => {
      expect(redactErrorBody('see example.com for context')).toBe('see example.com for context');
    });
  });

  describe('anthropic_key', () => {
    it('redacts Anthropic API keys (label-specific, beats generic sk-)', () => {
      const key = 'sk-ant-api03-' + 'a'.repeat(95);
      expect(redactErrorBody(key)).toBe('[REDACTED:anthropic_key]');
    });
    it('does NOT mis-label a generic sk-* as Anthropic', () => {
      const generic = 'sk-' + 'x'.repeat(40);
      const out = redactErrorBody(generic);
      expect(out).toBe('[REDACTED:openai_key]');
    });
  });

  describe('stripe_key', () => {
    it('redacts Stripe live/test/refresh keys', () => {
      expect(redactErrorBody('sk_live_' + 'Z'.repeat(32))).toBe('[REDACTED:stripe_key]');
      expect(redactErrorBody('sk_test_' + 'Q'.repeat(32))).toBe('[REDACTED:stripe_key]');
      expect(redactErrorBody('rk_live_' + 'R'.repeat(40))).toBe('[REDACTED:stripe_key]');
    });
  });

  describe('openai_key', () => {
    it('redacts OpenAI sk-/sk-proj-/sk-svc- keys', () => {
      expect(redactErrorBody('sk-' + 'A'.repeat(48))).toBe('[REDACTED:openai_key]');
      expect(redactErrorBody('sk-proj-' + 'B'.repeat(40))).toBe('[REDACTED:openai_key]');
      expect(redactErrorBody('sk-svc-' + 'C'.repeat(40))).toBe('[REDACTED:openai_key]');
    });
  });

  describe('aws_key', () => {
    it('redacts AWS access key IDs by catalog prefix', () => {
      expect(redactErrorBody('AKIA' + 'A'.repeat(16))).toBe('[REDACTED:aws_key]');
      expect(redactErrorBody('AROA' + 'X'.repeat(16))).toBe('[REDACTED:aws_key]');
    });
    it('does not redact short uppercase strings', () => {
      expect(redactErrorBody('AKIASHORT')).toBe('AKIASHORT');
    });
  });

  describe('github_token', () => {
    it('redacts ghp_/gho_/ghs_/ghu_/ghr_ tokens', () => {
      expect(redactErrorBody('ghp_' + 'a'.repeat(36))).toBe('[REDACTED:github_token]');
      expect(redactErrorBody('gho_' + 'b'.repeat(36))).toBe('[REDACTED:github_token]');
      expect(redactErrorBody('ghs_' + 'c'.repeat(36))).toBe('[REDACTED:github_token]');
    });
    it('does not redact short ghx_ strings', () => {
      expect(redactErrorBody('ghp_short')).toBe('ghp_short');
    });
  });

  describe('slack_token', () => {
    it('redacts xoxb/xoxp/xoxa/xoxr/xoxs tokens', () => {
      expect(redactErrorBody('xoxb-1234567890-abcdef')).toBe('[REDACTED:slack_token]');
      expect(redactErrorBody('xoxp-' + 'x'.repeat(20))).toBe('[REDACTED:slack_token]');
    });
  });

  describe('jwt', () => {
    it('redacts a three-segment JWT', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9'
        + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0'
        + '.' + 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      expect(redactErrorBody(jwt)).toBe('[REDACTED:jwt]');
    });
    it('does not redact short base64 chunks', () => {
      expect(redactErrorBody('eyJ.x.y')).toBe('eyJ.x.y');
    });
  });

  describe('bearer', () => {
    it('redacts Bearer / bearer tokens', () => {
      const tok = 'a'.repeat(30);
      expect(redactErrorBody('Bearer ' + tok)).toBe('Bearer [REDACTED:bearer]');
      expect(redactErrorBody('bearer ' + tok)).toBe('bearer [REDACTED:bearer]');
    });
    it('does not redact short bearer strings', () => {
      expect(redactErrorBody('Bearer abc')).toBe('Bearer abc');
    });
  });

  describe('card', () => {
    it('redacts 16-digit spaced/dashed card-like strings', () => {
      expect(redactErrorBody('4111 1111 1111 1111')).toBe('[REDACTED:card]');
      expect(redactErrorBody('4111-1111-1111-1111')).toBe('[REDACTED:card]');
      expect(redactErrorBody('4111111111111111')).toBe('[REDACTED:card]');
    });
    it('redacts Amex 15-digit strings', () => {
      expect(redactErrorBody('3782 822463 10005')).toBe('[REDACTED:card]');
    });
    it('does not redact short digit runs', () => {
      expect(redactErrorBody('1234 5678 9012')).toBe('1234 5678 9012');
    });
  });

  describe('ssn', () => {
    it('redacts US SSN patterns', () => {
      expect(redactErrorBody('123-45-6789')).toBe('[REDACTED:ssn]');
    });
    it('does not redact three-two-four digit runs without dashes', () => {
      expect(redactErrorBody('123456789 123-45-6789 456')).toBe('123456789 [REDACTED:ssn] 456');
    });
  });

  describe('phone', () => {
    it('redacts US phone patterns with separators', () => {
      expect(redactErrorBody('(415) 555-0132')).toBe('[REDACTED:phone]');
      expect(redactErrorBody('415-555-0132')).toBe('[REDACTED:phone]');
      expect(redactErrorBody('415.555.0132')).toBe('[REDACTED:phone]');
    });
    it('does not redact bare 10-digit runs without separators', () => {
      expect(redactErrorBody('4155550132')).toBe('4155550132');
    });
  });

  describe('ip', () => {
    it('redacts valid IPv4 addresses', () => {
      expect(redactErrorBody('192.168.1.42')).toBe('[REDACTED:ip]');
      expect(redactErrorBody('10.0.0.255')).toBe('[REDACTED:ip]');
    });
    it('does not redact invalid octets', () => {
      expect(redactErrorBody('999.999.999.999')).toBe('999.999.999.999');
      expect(redactErrorBody('1.2.3')).toBe('1.2.3');
    });
  });

  describe('pem_private_key', () => {
    it('redacts a multi-line PEM private key block', () => {
      const pem =
        '-----BEGIN RSA PRIVATE KEY-----\n' +
        'MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n' +
        'KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwIDAQABAkAFw8reMMuQ1sF2osHm\n' +
        '-----END RSA PRIVATE KEY-----\n';
      expect(redactErrorBody(pem)).toBe('[REDACTED:pem_private_key]\n');
    });
    it('does NOT crash on truncated PEM', () => {
      expect(redactErrorBody('-----BEGIN PRIVATE KEY-----\nMIIB\n'))
        .toBe('-----BEGIN PRIVATE KEY-----\nMIIB\n');
    });
  });

  describe('idempotence', () => {
    it('running twice on the same input returns the same value', () => {
      const tokens = [
        'user@example.com',
        'sk-' + 'a'.repeat(40),
        'Bearer ' + 'b'.repeat(30),
        '192.168.1.1',
        'eyJ' + 'x'.repeat(20) + '.' + 'y'.repeat(20) + '.' + 'z'.repeat(20),
      ];
      for (const s of tokens) {
        const once = redactErrorBody(s);
        const twice = redactErrorBody(once);
        expect(twice).toBe(once);
      }
    });
    it('redaction markers themselves never match any pattern', () => {
      const marker = '[REDACTED:email]';
      expect(redactErrorBody(marker)).toBe(marker);
      expect(redactErrorBody(`[REDACTED:${''}]`)).toBe(`[REDACTED:${''}]`);
      expect(redactErrorBody('[REDACTED:]')).toBe('[REDACTED:]');
    });
  });

  describe('length cap', () => {
    it('caps input length at REDACT_INPUT_MAX', () => {
      expect(REDACT_INPUT_MAX).toBe(32 * 1024);
      const big = 'A'.repeat(100 * 1024);
      const out = redactErrorBody(big);
      expect(out.length).toBeLessThanOrEqual(REDACT_INPUT_MAX);
      expect(out).toBe('A'.repeat(REDACT_INPUT_MAX));
    });
    it('short input passes through unchanged', () => {
      expect(redactErrorBody('hello world')).toBe('hello world');
    });
    it('empty input is empty output', () => {
      expect(redactErrorBody('')).toBe('');
    });
  });

  describe('cross-pattern interaction', () => {
    it('a 4xx body with multiple secrets batch-redacts correctly', () => {
      const body = JSON.stringify({
        type: 'error',
        message: "Invalid request",
        hints: 'Echoed Authorization: Bearer ' + 'z'.repeat(40),
        context: 'request originated from user@example.com via 10.0.0.1',
      });
      const redacted = redactErrorBody(body);
      expect(redacted).toContain('[REDACTED:bearer]');
      expect(redacted).toContain('[REDACTED:email]');
      expect(redacted).toContain('[REDACTED:ip]');
      expect(redacted).not.toContain('z'.repeat(40));
      expect(redacted).not.toContain('user@example.com');
      expect(redacted).not.toContain('10.0.0.1');
    });
  });

  describe('re-exported pattern set', () => {
    it('is non-empty, opens with email, and ends with pem_private_key', () => {
      // Locks the public ordering so a dashboard can humanize kind labels.
      const ps = redactionPatterns();
      expect(ps.length).toBeGreaterThan(0);
      expect(ps[0]!.kind).toBe('email');
      expect(ps[ps.length - 1]!.kind).toBe('pem_private_key');
    });
  });
});

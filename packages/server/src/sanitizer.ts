import type { LogMessage } from '@console-mcp/shared';

interface SanitizationPattern {
  pattern: RegExp;
  replacement: string;
  description: string;
}

export class Sanitizer {
  private patterns: SanitizationPattern[] = [
    {
      pattern: /\b[A-Za-z0-9_-]{20,}\b/g,
      replacement: '[API_KEY_MASKED]',
      description: 'Long alphanumeric strings (API keys)',
    },
    {
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: '[EMAIL_MASKED]',
      description: 'Email addresses',
    },
    {
      pattern: /\bey[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*\b/g,
      replacement: '[JWT_MASKED]',
      description: 'JWT tokens',
    },
    {
      pattern: /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]+/gi,
      replacement: '[AUTH_MASKED]',
      description: 'Authorization headers',
    },
    {
      pattern:
        /\b(?:password|secret|api_?key|token)\s*[:=]\s*["']?([^\s,}"']+)["']?/gi,
      replacement: '$1: [MASKED]',
      description: 'Password/secret key-value pairs',
    },
    {
      pattern: /\b\d{13,16}\b/g,
      replacement: '[CC_MASKED]',
      description: 'Credit card numbers',
    },
    {
      pattern:
        /https?:\/\/([^:]+):([^@]+)@/g,
      replacement: 'https://[USER]:[PASS]@',
      description: 'URL credentials',
    },
    {
      pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
      replacement: '[STRIPE_KEY_MASKED]',
      description: 'Stripe API keys',
    },
    {
      pattern: /\bAKIA[0-9A-Z]{16}\b/g,
      replacement: '[AWS_KEY_MASKED]',
      description: 'AWS access keys',
    },
  ];

  private enabled: boolean = true;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  sanitize(log: LogMessage): LogMessage {
    if (!this.enabled) {
      return log;
    }

    return {
      ...log,
      message: this.sanitizeText(log.message),
      args: this.sanitizeArgs(log.args),
      stack: log.stack ? this.sanitizeText(log.stack) : undefined,
    };
  }

  sanitizeMultiple(logs: LogMessage[]): LogMessage[] {
    return logs.map((log) => this.sanitize(log));
  }

  private sanitizeText(text: string): string {
    let sanitized = text;
    for (const { pattern, replacement } of this.patterns) {
      sanitized = sanitized.replace(pattern, replacement);
    }
    return sanitized;
  }

  private sanitizeArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (typeof arg === 'string') {
        return this.sanitizeText(arg);
      }
      if (typeof arg === 'object' && arg !== null) {
        return this.sanitizeObject(arg);
      }
      return arg;
    });
  }

  private sanitizeObject(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitizeObject(item));
    }

    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Mask entire value if key looks sensitive
      if (/password|secret|token|key|credential/i.test(key)) {
        sanitized[key] = '[MASKED]';
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitizeText(value);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  addPattern(pattern: RegExp, replacement: string, description: string): void {
    this.patterns.push({ pattern, replacement, description });
  }

  getPatterns(): readonly SanitizationPattern[] {
    return this.patterns;
  }
}

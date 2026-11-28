import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.ts';

const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://marketing_app:s3cret-app@127.0.0.1:5432/marketing',
  DATABASE_ADMIN_URL: 'postgres://marketing:s3cret-owner@127.0.0.1:5432/marketing',
  DBOS_SYSTEM_DATABASE_URL: 'postgres://marketing:s3cret-owner@127.0.0.1:5432/marketing_dbos',
  S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  S3_ACCESS_KEY_ID: 'key-id',
  S3_SECRET_ACCESS_KEY: 'key-secret',
  AI_MODEL: 'anthropic:claude-opus-5-5',
  ANTHROPIC_API_KEY: 'sk-test',
};

describe('config', () => {
  it('runs on the development defaults outside production', () => {
    expect(parseConfig({}).DATABASE_URL).toContain('marketing_app:marketing_app@');
  });

  it('refuses in production the development defaults and passwords, the mock model and a missing model key', () => {
    expect(parseConfig(prod).S3_ACCESS_KEY_ID).toBe('key-id');
    expect(() => parseConfig({ NODE_ENV: 'production' })).toThrow(
      'set DATABASE_URL, DATABASE_ADMIN_URL, DBOS_SYSTEM_DATABASE_URL, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, ANTHROPIC_API_KEY',
    );
    expect(() => parseConfig({ ...prod, DATABASE_ADMIN_URL: 'postgres://marketing:marketing@10.0.0.5:5432/marketing' })).toThrow('set DATABASE_ADMIN_URL ');
    expect(() => parseConfig({ ...prod, S3_SECRET_ACCESS_KEY: 'dev' })).toThrow('set S3_SECRET_ACCESS_KEY ');
    expect(() => parseConfig({ ...prod, AI_MODEL: 'mock' })).toThrow('set AI_MODEL ');
    expect(() => parseConfig({ ...prod, AI_MODEL: 'openrouter:anthropic/claude-opus-5.5' })).toThrow('set OPENROUTER_API_KEY ');
  });

  it('refuses the mock search provider in production', () => {
    expect(() => parseConfig({ ...prod, SEARCH_PROVIDER: 'mock' })).toThrow('SEARCH_PROVIDER');
  });
});

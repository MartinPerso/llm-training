import { describe, expect, it } from 'vitest';
import { checkNumeric, formatNumber, parseNumeric } from './numeric.ts';

describe('parseNumeric', () => {
  const cases: Array<[string, number]> = [
    ['18', 18],
    [' 18 ', 18],
    ['1.5e9', 1.5e9],
    ['1.5E9', 1.5e9],
    ['1.5B', 1.5e9],
    ['1.5 B', 1.5e9],
    ['3k', 3000],
    ['3K', 3000],
    ['2.5M', 2.5e6],
    ['1T', 1e12],
    ['2^30', 2 ** 30],
    ['2 ^ 10', 1024],
    ['2**10', 1024],
    ['10^-3', 0.001],
    ['1,000', 1000],
    ['1,000,000', 1e6],
    ['-0.5', -0.5],
    ['.5', 0.5],
    ['50%', 0.5],
    ['1.5*2^10', 1536],
    ['1/4', 0.25],
    ['−3', -3],
    ['-2^2', -4],
  ];
  it.each(cases)('parses %s', (input, expected) => {
    expect(parseNumeric(input)).toBeCloseTo(expected, 9);
  });

  it.each(['', '   ', 'abc', '1.5Q', '12 apples', '1..2', '2^', '*3', '1/0', '1e999', 'NaN', 'Infinity'])(
    'rejects %j',
    (input) => {
      expect(parseNumeric(input)).toBeNull();
    },
  );
});

describe('checkNumeric', () => {
  it('uses a 5% relative tolerance by default', () => {
    expect(checkNumeric('100', 100)).toBe(true);
    expect(checkNumeric('104', 100)).toBe(true);
    expect(checkNumeric('96', 100)).toBe(true);
    expect(checkNumeric('106', 100)).toBe(false);
    expect(checkNumeric('1.9B', 2e9)).toBe(true);
    expect(checkNumeric('1.8B', 2e9)).toBe(false);
  });

  it('honours a custom tolerance', () => {
    expect(checkNumeric('110', 100, 0.1)).toBe(true);
    expect(checkNumeric('111', 100, 0.1)).toBe(false);
  });

  it('tolerance 0 means exact', () => {
    expect(checkNumeric('18', 18, 0)).toBe(true);
    expect(checkNumeric('18.01', 18, 0)).toBe(false);
    expect(checkNumeric('2^20', 1048576, 0)).toBe(true);
    expect(checkNumeric('1.048576M', 1048576, 0)).toBe(true);
    expect(checkNumeric('0.1', 0.1, 0)).toBe(true);
  });

  it('answer 0 uses an absolute epsilon', () => {
    expect(checkNumeric('0', 0)).toBe(true);
    expect(checkNumeric('0.0000000001', 0)).toBe(true);
    expect(checkNumeric('0.01', 0)).toBe(false);
  });

  it('works for negative answers and unparseable input', () => {
    expect(checkNumeric('-9.8', -10)).toBe(true);
    expect(checkNumeric('9.8', -10)).toBe(false);
    expect(checkNumeric('nope', 10)).toBe(false);
  });
});

describe('formatNumber', () => {
  it('formats readable numbers', () => {
    expect(formatNumber(18)).toBe('18');
    expect(formatNumber(1048576)).toBe('1,048,576');
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(1.5e18)).toBe('1.5e+18');
  });
});
